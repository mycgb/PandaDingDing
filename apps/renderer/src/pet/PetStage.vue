<template>
  <div ref="stageHost" class="pet-stage">
    <!-- PixiJS 画布挂载点 -->
    <!-- 中心互动区：no-drag + 渲染层手写拖拽，支持"按住熊猫拖动"和双击打开面板 -->
    <div class="hit-area" @pointerdown="onDragStart" @dblclick="onDblClick" title="拖动移动 · 双击打开面板"></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Application, Sprite, Texture } from 'pixi.js'
import type { PetState } from '@shared/index'
import { api } from '../api'

const props = defineProps<{ state: PetState; skin: string }>()
const emit = defineEmits<{ (e: 'open-panel'): void }>()

/**
 * 皮肤 manifest 约定（兼容两代格式）：
 *  - 1.0：每个动作独立存放 actions/<name>/0001.png…，frames 为帧数
 *  - 2.0：动作可通过 from/start 复用另一个动作的帧池（避免磁盘/内存翻倍）；
 *         fps 可按动作覆盖；display 指定精灵在画布中的展示宽高与基线
 */
interface ActionCfg {
  frames: number
  loop: boolean
  next?: string | null
  fps?: number
  from?: string        // 复用哪个动作的帧池（默认同名目录）
  start?: number       // 从源帧池的第几帧开始（1 基，默认 1）
}
interface DisplayCfg { width?: number; height?: number; bottom?: number }
interface SkinManifest {
  name: string
  fps: number
  anchor: [number, number]
  actions: Record<string, ActionCfg>
  display?: DisplayCfg
}

const stageHost = ref<HTMLDivElement>()

/** 画布尺寸：Pixi 自适应容器，这里给固定基准，display 负责角色缩放。
 *  与主进程 index.ts 的 PET_W/PET_H 保持一致。 */
const STAGE_W = 160
const STAGE_H = 210

let app: Application | null = null
let sprite: Sprite | null = null
let manifest: SkinManifest | null = null
/** 帧池：只存放真实加载过的目录（如 idle），其他动作按 from 引用 */
const pools = new Map<string, Texture[]>()
let currentAction = ''
let currentFrame = 0
let frameTimer: ReturnType<typeof setInterval> | null = null
let displayCfg: DisplayCfg = {}

/** 诊断对象：便于冒烟/调试时从 DevTools 读取 */
function diag(extra: Record<string, unknown>): void {
  ;(window as unknown as { __petDebug?: unknown }).__petDebug = {
    skin: props.skin, action: currentAction, frame: currentFrame,
    pools: [...pools.keys()], display: displayCfg, ...extra,
  }
}

/** 通过 fetch → ImageBitmap → Texture 加载单帧（绕过自定义协议下 Assets 的图片解码限制） */
async function loadTexture(url: string): Promise<Texture> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`)
  const blob = await res.blob()
  const bmp = await createImageBitmap(blob)
  return Texture.from(bmp)
}

function skinBase(skin: string): string {
  return location.protocol === 'file:' ? `pt-resource://skins/${skin}` : `/skins/${skin}`
}

async function loadPool(base: string, name: string, frames: number): Promise<Texture[]> {
  const cached = pools.get(name)
  if (cached) return cached
  const out: Texture[] = []
  for (let i = 1; i <= frames; i++) {
    out.push(await loadTexture(`${base}/actions/${name}/${String(i).padStart(4, '0')}.png`))
  }
  pools.set(name, out)
  return out
}

async function loadSkin(skin: string): Promise<void> {
  const base = skinBase(skin)
  const mfRes = await fetch(`${base}/manifest.json`)
  if (!mfRes.ok) throw new Error(`manifest HTTP ${mfRes.status}`)
  manifest = (await mfRes.json()) as SkinManifest
  pools.clear()
  displayCfg = manifest.display ?? {}

  // 收集所有「需要真实加载」的帧池名：
  //   - 动作自带目录（未声明 from）→ 自己的名字
  //   - 动作声明 from → from 指向的名字（该动作本身不单独占磁盘）
  const poolNames = new Set<string>()
  for (const [name, cfg] of Object.entries(manifest.actions)) {
    poolNames.add(cfg.from ?? name)
  }
  for (const poolName of poolNames) {
    const poolFrames = manifest.actions[poolName]?.frames ?? 0
    if (poolFrames <= 0) throw new Error(`帧池 ${poolName} 未在 manifest 中声明帧数`)
    await loadPool(base, poolName, poolFrames)
  }
  diag({ loaded: true, manifestName: manifest.name, poolNames: [...poolNames] })
}

/** 取某动作在某一播放帧上的实际贴图 */
function frameFor(key: string, index: number): Texture | null {
  if (!manifest) return null
  const cfg = manifest.actions[key]
  if (!cfg) return null
  const poolName = cfg.from ?? key
  const pool = pools.get(poolName)
  if (!pool || pool.length === 0) return null
  const start = Math.max(0, (cfg.start ?? 1) - 1)
  const i = Math.min(pool.length - 1, start + index)
  return pool[i] ?? null
}

function resolveAction(action: string): string {
  if (manifest && manifest.actions[action]) return action
  if (action === 'panic-happy') return resolveAction('happy')
  if (action === 'panic-sad') return resolveAction('sad')
  if (action === 'offline') return resolveAction('sleep')
  if (action === 'sleepy') return resolveAction('idle')
  return 'idle'
}

function playAction(action: string): void {
  if (!manifest || !sprite) return
  const key = resolveAction(action)
  const cfg = manifest.actions[key]
  if (!cfg || cfg.frames <= 0) return
  const first = frameFor(key, 0)
  if (!first) return

  currentAction = key
  currentFrame = 0
  sprite.texture = first
  const fps = cfg.fps ?? manifest.fps ?? 12
  const loop = cfg.loop
  const next = cfg.next ?? null
  const stepMs = Math.max(16, Math.round(1000 / fps))

  stopFrameTimer()
  // 用 setInterval 驱动而非 Pixi ticker：
  // ticker 挂在 requestAnimationFrame 上，窗口被遮挡/系统节流时会掉到 1Hz，
  // 表现为"桌宠不动"。setInterval 在渲染进程关闭 backgroundThrottling 后
  // 仍按真实间隔触发，是桌宠持续动画的可靠做法。
  frameTimer = setInterval(() => {
    if (!manifest) return
    currentFrame += 1
    if (currentFrame >= cfg.frames) {
      if (loop) currentFrame = 0
      else if (next) { playAction(next); return }
      else {
        currentFrame = cfg.frames - 1
        stopFrameTimer()
      }
    }
    const t = frameFor(currentAction, currentFrame)
    if (t && sprite) sprite.texture = t
    diag({ frame: currentFrame })
  }, stepMs)
  diag({ playing: key, fps, stepMs })
}

function stopFrameTimer(): void {
  if (frameTimer !== null) { clearInterval(frameTimer); frameTimer = null }
}

onMounted(async () => {
  try {
    app = new Application()
    await app.init({
      backgroundAlpha: 0,
      width: STAGE_W, height: STAGE_H,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    stageHost.value?.appendChild(app.canvas)
    // 确保画布自身不填充底色，透明窗口才能透出桌面
    app.canvas.style.background = 'transparent'

    await applySkin(props.skin)
    diag({ mounted: true, spriteW: sprite?.width, spriteH: sprite?.height })
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.error('[pet] init failed:', msg)
    diag({ error: msg })
  }
})

/**
 * 加载并应用皮肤：销毁旧精灵、重建精灵、恢复当前动作。
 * 供首次挂载与运行中切换皮肤复用。
 */
async function applySkin(skinId: string): Promise<void> {
  await loadSkin(skinId)

  const idleCfg = manifest!.actions['idle']
  const idle = idleCfg ? frameFor('idle', 0) : null
  if (!idle) throw new Error('皮肤无可用帧')

  stopFrameTimer()
  if (sprite) {
    app?.stage.removeChild(sprite)
    sprite.destroy()
    sprite = null
  }
  sprite = new Sprite(idle)
  sprite.anchor.set(0.5, 1)
  sprite.x = STAGE_W / 2
  sprite.y = STAGE_H - 12
  applyDisplaySize()
  app!.stage.addChild(sprite)
  playAction(props.state.action)
  diag({ skinChanged: skinId })
}

/** 运行中切换皮肤（设置页改皮肤后由父组件传入新值） */
watch(() => props.skin, async (next, prev) => {
  if (!app || !next || next === prev) return
  try {
    await applySkin(next)
  } catch (e) {
    console.error('[pet] skin switch failed:', e)
    diag({ skinError: String(e) })
  }
})

/** 依据 manifest.display 与帧原始尺寸设置精灵显示大小 */
function applyDisplaySize(): void {
  if (!sprite || !manifest) return
  const tw = sprite.texture.width
  const th = sprite.texture.height
  const d = displayCfg
  if (d.width && d.height) {
    sprite.width = d.width
    sprite.height = d.height
  } else if (d.width) {
    sprite.width = d.width
    sprite.height = (d.width / tw) * th
  } else {
    // 无 display 配置：长边 200px 等比缩放（兼容旧皮肤）
    const scale = 200 / Math.max(tw, th)
    sprite.width = tw * scale
    sprite.height = th * scale
  }
  if (d.bottom !== undefined) sprite.y = STAGE_H - d.bottom
}

onBeforeUnmount(() => {
  stopFrameTimer()
  app?.destroy(true)
})

watch(() => props.state.action, (a) => playAction(a))

defineExpose({ setAction: (a: string) => playAction(a) })

/* ---------- 双击打开面板 ---------- */

/**
 * 熊猫主体区域（.hit-area）是 no-drag，以便渲染层同时支持：
 *   1) 按住拖动：pointerdown/move/up + petNudge IPC
 *   2) 双击打开面板：dblclick
 * 两者用 moved 标记协调：拖动过就不触发双击。
 * 外围仍是 app-region:drag（OS 接管），拖动同样可靠。
 */
let draggingHit = false
let moved = false

function onDragStart(e: PointerEvent): void {
  if (e.button !== 0) return
  draggingHit = true
  moved = false
  // 用 movementX/Y：相对位移，不受 screenX 坐标系与捕获影响
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  window.addEventListener('pointercancel', onDragEnd)
}

function onDragMove(e: PointerEvent): void {
  if (!draggingHit) return
  const dx = e.movementX || 0
  const dy = e.movementY || 0
  // 钳制单帧位移，防坐标跳变把窗口甩飞
  if (Math.abs(dx) > 100 || Math.abs(dy) > 100) return
  if (Math.abs(dx) + Math.abs(dy) > 1) {
    moved = true
    api.petNudge(dx, dy).catch(() => {})
  }
}

function onDragEnd(_e: Event): void {
  draggingHit = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
}

function onDblClick(): void {
  if (moved) { moved = false; return }   // 拖拽收尾产生的 dblclick，忽略
  emit('open-panel')
}
</script>

<style scoped>
.pet-stage {
  width: 160px;
  height: 210px;
  cursor: grab;
  user-select: none;
  /* 原生 app-region 拖拽最可靠（鼠标移出窗口不断）。
     双击打开面板由主进程 screen 坐标检测实现（app-region 会吞渲染层 dblclick）。 */
  -webkit-app-region: drag;
  app-region: drag;
}
.pet-stage :deep(.bubble-layer) {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
/* 中心双击命中区：no-drag 才能收到 dblclick；透明且盖在熊猫主体上 */
.hit-area {
  position: absolute;
  left: 15%; top: 30%;
  width: 70%; height: 55%;
  background: transparent;
  -webkit-app-region: no-drag;
  app-region: no-drag;
  cursor: grab;
}
.pet-root :deep(.hit-area):active { cursor: grabbing; }
</style>
