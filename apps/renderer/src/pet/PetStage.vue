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
import { breathCurve } from '@shared/index'
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
  /**
   * 帧间交叉淡入时长（ms）：帧数少、姿态差异大的动作（如哭，只有 4 帧）硬切会一卡一卡，
   * 开启后新帧从透明渐变覆盖旧帧，消除跳变。0/缺省为直接切换（默认行为不变）。
   */
  fadeMs?: number
  /**
   * 程序化呼吸：用单帧 + 正弦曲线做缩放，替代「多帧切换」。
   * 多帧呼吸受绘制质量限制（AI 出的帧往往是整体位移而非腹部起伏），
   * 逐帧切换必然顿挫；连续缩放是 60fps 平滑的。
   */
  breath?: {
    periodMs?: number   // 一次呼吸周期，默认 4000
    amountY?: number    // 纵向放大比例（0.035 = 峰值 +3.5%），默认 0.035
    amountX?: number    // 纵向放大时横向压缩比例，保持体积感，默认 0.012
  }
  /**
   * 程序化抖动：提醒触发时让桌宠"抓狂 / 摇头"。
   * 不想为每个情绪再画一套帧（AI 出图成本高且容易走形），
   * 用旋转 + 水平位移的正弦抖动叠加在现有帧上，同样是 30fps 连续平滑。
   */
  shake?: {
    periodMs?: number   // 抖一个来回的周期，默认 180（越小越急）
    angle?: number      // 最大倾角（度），负数表示反向
    x?: number          // 水平位移幅度（px）
  }
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
/** 交叉淡入用叠层精灵：新帧先画在它上面、alpha 0→1 渐变，完成后写回主 sprite。仅 fadeMs>0 的动作使用 */
let fadeSprite: Sprite | null = null
let fadeTimer: ReturnType<typeof setInterval> | null = null
let fadeStart = 0
let fadeDuration = 0
let manifest: SkinManifest | null = null
/** 帧池：只存放真实加载过的目录（如 idle），其他动作按 from 引用 */
const pools = new Map<string, Texture[]>()
let currentAction = ''
let currentFrame = 0
let frameTimer: ReturnType<typeof setInterval> | null = null
let displayCfg: DisplayCfg = {}
/** 缩放基准（由 display 决定）与朝向符号，呼吸只在这两个之上做叠加 */
let baseScaleX = 1
let baseScaleY = 1
let facingSign = 1
/** 程序化变换（呼吸缩放 + 抖动）的定时器与参数 */
let transformTimer: ReturnType<typeof setInterval> | null = null
let transformStart = 0
let breathPeriodMs = 4000
let breathAmountX = 0
let breathAmountY = 0
let shakePeriodMs = 180
let shakeAngle = 0
let shakeX = 0

/** 诊断对象：便于冒烟/调试时从 DevTools 读取（累加合并，避免后一次 diag 覆盖掉呼吸等标记） */
function diag(extra: Record<string, unknown>): void {
  const w = window as unknown as { __petDebug?: Record<string, unknown> }
  w.__petDebug = {
    ...(w.__petDebug ?? {}),
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
  // 今日收益情绪：老皮肤没有独立的 cheer/cry，降级到同帧池的 happy/sad
  if (action === 'cheer') return resolveAction('happy')
  if (action === 'cry') return resolveAction('sad')
  if (action === 'panic-happy') return resolveAction('happy')
  if (action === 'panic-sad') return resolveAction('sad')
  // 老皮肤没有 alert-time：退化成摇头（sad 帧）也不会没反应
  if (action === 'alert-time') return resolveAction('sad')
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
  // 切动作：立刻显示第一帧，先收掉上一个动作可能残留的淡入叠层
  stopFade()
  sprite.texture = first
  // 朝向在每次切动作时统一重置：walk 向左时 scale.x 为负，
  // 若只在 watch 里纠正，任何绕过 watch 的切换（皮肤热更、直接 setAction）
  // 都会让非走路动作继承镜像，横幅文字会反着显示。
  applyFacing()
  const fps = cfg.fps ?? manifest.fps ?? 12
  const loop = cfg.loop
  const next = cfg.next ?? null
  const stepMs = Math.max(16, Math.round(1000 / fps))
  // 帧间淡入时长：不得超过帧间隔，且至少留一帧稳态（默认 0 = 直接切换）
  fadeDuration = Math.min(cfg.fadeMs ?? 0, Math.max(0, stepMs - 60))

  stopFrameTimer()
  stopTransformTimer()

  // 呼吸参数：只有声明了 breath 才缩放，否则必须归零，
  // 否则上一个动作的呼吸幅度会被带到提醒抖动里（看起来像中邪）
  breathPeriodMs = cfg.breath?.periodMs ?? 4000
  breathAmountY = cfg.breath?.amountY ?? 0
  breathAmountX = cfg.breath?.amountX ?? 0
  // 抖动参数：提醒动作专用
  shakePeriodMs = Math.max(60, cfg.shake?.periodMs ?? 180)
  shakeAngle = cfg.shake?.angle ?? 0
  shakeX = cfg.shake?.x ?? 0

  // 呼吸 / 抖动都用 30fps 变换驱动（Pixi 仍在 rAF 上合成，肉眼看是连续的）
  if (cfg.breath || cfg.shake) {
    transformStart = performance.now()
    transformTimer = setInterval(() => {
      applyTransform(performance.now() - transformStart)
    }, 33)
    applyTransform(0)
    diag({
      playing: key, transform: true, breathing: !!cfg.breath,
      periodMs: breathPeriodMs, amountY: breathAmountY,
      shaking: !!cfg.shake, shakePeriodMs, shakeAngle, shakeX,
    })
  }

  if (cfg.breath) return

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
    if (t) setFrame(t)
    diag({ frame: currentFrame })
  }, stepMs)
  diag({ playing: key, fps, stepMs, fadeDuration })
}

/**
 * 设置当前帧：fadeDuration>0 时用交叉淡入（新帧从 alpha 0 渐变到 1），否则直接换贴图。
 * 淡入叠层 fadeSprite 盖在主 sprite 上、与主 sprite 同变换；淡入完成后把结果写回主 sprite。
 */
function setFrame(t: Texture): void {
  if (fadeDuration <= 0 || !sprite || !app) { if (sprite) sprite.texture = t; return }
  if (!fadeSprite) return
  if (fadeTimer !== null) { clearInterval(fadeTimer); finishFade() }   // 上一帧淡入未完先落定，避免叠层错乱
  fadeSprite.texture = t
  fadeSprite.alpha = 0
  fadeSprite.visible = true
  // 新贴图设好后再锁定显示尺寸（Pixi 按当前贴图算 scale），保证淡入帧不缩放跳变
  fadeSprite.width = sprite.width
  fadeSprite.height = sprite.height
  fadeSprite.x = sprite.x
  fadeSprite.y = sprite.y
  fadeSprite.rotation = sprite.rotation
  fadeStart = performance.now()
  fadeTimer = setInterval(() => {
    if (!fadeSprite || !sprite) return
    const p = Math.min(1, (performance.now() - fadeStart) / fadeDuration)
    fadeSprite.alpha = p
    diag({ fading: true, fadeAlpha: Number(p.toFixed(3)) })
    if (p >= 1) finishFade()
  }, 16)   // ~60fps 渐变
  diag({ fading: true, fadeAlpha: 0 })
}

/** 淡入完成/中断：把叠层贴图写回主精灵并隐藏叠层 */
function finishFade(): void {
  if (fadeTimer !== null) { clearInterval(fadeTimer); fadeTimer = null }
  if (fadeSprite && sprite && fadeSprite.texture) {
    sprite.texture = fadeSprite.texture
    fadeSprite.visible = false
    fadeSprite.alpha = 0
  }
  fadeDoneCount += 1
  diag({ fading: false, fadeAlpha: 1, fadeDoneCount })
}

/** 切动作时收掉淡入叠层，但保留主 sprite 当前帧（不强行落定，下一行会设第一帧） */
function stopFade(): void {
  if (fadeTimer !== null) { clearInterval(fadeTimer); fadeTimer = null }
  if (fadeSprite) { fadeSprite.visible = false; fadeSprite.alpha = 0 }
  diag({ fading: false })
}

let fadeDoneCount = 0

function stopFrameTimer(): void {
  if (frameTimer !== null) { clearInterval(frameTimer); frameTimer = null }
}

function stopTransformTimer(): void {
  if (transformTimer !== null) { clearInterval(transformTimer); transformTimer = null }
}

/**
 * 应用变换：缩放（基准 × 呼吸 × 朝向）与抖动（旋转 + 水平位移）。
 * 所有改缩放/旋转/位置的地方都必须走这里，否则呼吸、朝向、抖动会互相覆盖。
 */
function applyTransform(elapsedMs = 0): void {
  if (!sprite) return
  const f = breathCurve(elapsedMs, breathPeriodMs)
  sprite.scale.x = baseScaleX * (1 - breathAmountX * f) * facingSign
  sprite.scale.y = baseScaleY * (1 + breathAmountY * f)
  if (shakeAngle || shakeX) {
    // 正弦抖动：一个周期内左右各一次，"抓狂"看的是频率而不是幅度
    const phase = ((elapsedMs % shakePeriodMs) / shakePeriodMs) * Math.PI * 2
    const s = Math.sin(phase)
    sprite.rotation = (s * shakeAngle * Math.PI) / 180
    sprite.x = STAGE_W / 2 + s * shakeX
  } else {
    sprite.rotation = 0
    sprite.x = STAGE_W / 2
  }
  // 淡入叠层跟随主精灵变换；缩放还要乘以叠层当前帧的固有尺寸差
  // （各帧原始像素尺寸可能略有不同，主精灵靠 width/height 锁定显示尺寸，这里同步锁定）
  if (fadeSprite) {
    fadeSprite.anchor.copyFrom(sprite.anchor)
    fadeSprite.x = sprite.x
    fadeSprite.y = sprite.y
    fadeSprite.rotation = sprite.rotation
    // width/height 锁定显示尺寸（Pixi 按叠层当前贴图算 scale），各帧原始尺寸不同也对得上
    fadeSprite.width = sprite.width
    fadeSprite.height = sprite.height
  }
  // 供调试/冒烟读取，避免为了取缩放值反复截图
  ;(window as unknown as { __petBreath?: unknown }).__petBreath = {
    f: Number(f.toFixed(4)),
    scaleX: Number(sprite.scale.x.toFixed(4)),
    scaleY: Number(sprite.scale.y.toFixed(4)),
    rotation: Number(sprite.rotation.toFixed(4)),
    x: Number(sprite.x.toFixed(2)),
  }
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
  stopTransformTimer()
  if (fadeTimer !== null) { clearInterval(fadeTimer); fadeTimer = null }
  if (fadeSprite) {
    app?.stage.removeChild(fadeSprite)
    fadeSprite.destroy()
    fadeSprite = null
  }
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
  applyFacing()
  app!.stage.addChild(sprite)
  // 淡入叠层：初始隐藏，画在主精灵之上。setFrame 用到时再显示。
  fadeSprite = new Sprite(idle)
  fadeSprite.anchor.set(0.5, 1)
  fadeSprite.visible = false
  app!.stage.addChild(fadeSprite)
  applyTransform(0)   // 让叠层尺寸/位置与主精灵一致
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
  // 记下基准缩放：后续呼吸/朝向都在此之上叠加，不能直接改 scale
  baseScaleX = Math.abs(sprite.scale.x)
  baseScaleY = Math.abs(sprite.scale.y)
  applyTransform(0)
}

/** 漫游朝向：walk 且 facing=left 时水平翻转；其余动作恢复正向。 */
function applyFacing(): void {
  if (!sprite) return
  const left = props.state.action === 'walk' && props.state.facing === 'left'
  facingSign = left ? -1 : 1
  applyTransform(0)   // 切动作时呼吸归位，避免带着上一动作的幅度
  diag({ facing: left ? 'left' : 'right' })
}

onBeforeUnmount(() => {
  stopFrameTimer()
  stopTransformTimer()
  if (fadeTimer !== null) { clearInterval(fadeTimer); fadeTimer = null }
  app?.destroy(true)
})

watch(
  () => [props.state.action, props.state.facing] as const,
  ([a]) => { playAction(a); applyFacing() },
)

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
