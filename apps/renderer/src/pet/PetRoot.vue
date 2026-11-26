<template>
  <div class="pet-root" :class="{ 'has-pnl': !!pnlChip }">
    <PetStage ref="stage" :state="state" :skin="skin" @open-panel="onOpenPanel" />
    <!-- 底部新闻跑马灯：滚动展示最新快讯，可在设置里关掉 -->
    <NewsTicker v-if="newsTickerEnabled" />
    <!-- 收盘后：头顶挂一个「今日收益」小胶囊（红涨绿跌，睡觉时也保留） -->
    <div v-if="pnlChip" class="pnl-chip" :class="pnlChip.tone">{{ pnlChip.text }}</div>
    <BubbleLayer :class="{ 'bubble-hidden': sleeping }" :bubbles="bubbles" :bubble-color="bubbleColor"
                 :font-size="bubbleFontSize" @dismiss="dismiss" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PetStage from './PetStage.vue'
import NewsTicker from './NewsTicker.vue'
import BubbleLayer from './BubbleLayer.vue'
import { api, onPetState, onAlert, onNotice, onQuote, onSettingsChanged, onSoundPlay } from '../api'
import type { AlertEvent, PetState, QuoteSnapshot, SystemNotice, AppSettings, SoundKind } from '@shared/index'

const stage = ref<InstanceType<typeof PetStage>>()
const state = ref<PetState>({ action: 'idle' })
const skin = ref('mascot-cat')
const bubbleColor = ref('#14181e')
const bubbleFontSize = ref(11)
const bubbles = ref<Bubble[]>([])
const bubbleAlwaysOn = ref(false)
const newsTickerEnabled = ref(true)
const pnlChipEnabled = ref(true)
const livePnlEnabled = ref(true)

/** 躺睡状态（收盘 / 免打扰时段）：期间隐藏气泡，做到「睡着就安静」 */
const sleeping = computed(() => state.value.action === 'sleepy')

interface Bubble {
  id: number
  kind: 'tick' | 'alert' | 'system'
  text: string
  tone?: 'up' | 'down' | 'neutral'
}

let bubbleSeq = 1
let tickTimer: ReturnType<typeof setInterval> | null = null
/** 常显气泡的 id（不随 ttl 消失）与轮播游标 */
const alwaysBubbleId = 900000
let carouselIndex = 0

onMounted(async () => {
  const s = await api.settingsGet()
  skin.value = s.skin
  bubbleColor.value = s.bubbleColor || '#14181e'
  bubbleFontSize.value = s.bubbleFontSize || 11
  bubbleAlwaysOn.value = s.bubbleAlwaysOn === true
  newsTickerEnabled.value = s.newsTickerEnabled !== false
  pnlChipEnabled.value = s.pnlChipEnabled !== false
  livePnlEnabled.value = s.livePnlEnabled !== false
  onSettingsChanged((ns: AppSettings) => {
    newsTickerEnabled.value = ns.newsTickerEnabled !== false
    pnlChipEnabled.value = ns.pnlChipEnabled !== false
    livePnlEnabled.value = ns.livePnlEnabled !== false
    if (ns.bubbleColor) bubbleColor.value = ns.bubbleColor
    if (ns.bubbleFontSize) bubbleFontSize.value = ns.bubbleFontSize
    if (ns.skin && ns.skin !== skin.value) skin.value = ns.skin   // 皮肤实时切换
    const changed = ns.bubbleAlwaysOn !== bubbleAlwaysOn.value
    bubbleAlwaysOn.value = ns.bubbleAlwaysOn === true
    if (changed) configureTicker()
  })

  onPetState((ps) => {
    state.value = ps
    stage.value?.setAction(ps.action)
  })
  onAlert((e: AlertEvent) => {
    pushBubble({ kind: 'alert', text: `⚠ ${e.secName} ${e.value >= 0 ? '+' : ''}${e.value.toFixed(2)}%`, tone: e.direction === 'up' ? 'up' : 'down' }, 8000)
  })
  onNotice((n: SystemNotice) => {
    // 定时时点提醒要能"叫醒"人：level=alert 时按提醒样式展示，睡觉期间也不拦
    pushBubble({ kind: n.level === 'alert' ? 'alert' : 'system', text: n.message }, n.level === 'alert' ? 8000 : 5000)
  })
  onQuote((snaps: QuoteSnapshot[]) => {
    latest.value = snaps
    // 常显模式：行情更新时同步刷新当前常显气泡内容（价格实时变化）
    if (bubbleAlwaysOn.value) updateAlwaysBubble()
  })
  onSoundPlay((kind: SoundKind) => playSound(kind))

  configureTicker()
})

/**
 * 提示音：主进程判断开关后推 kind 过来，这里只负责发声。
 * 音频文件放 resources/sounds，与皮肤一样走 pt-resource（打包）/ 静态目录（dev）。
 * 用 Audio 池缓存实例：首次 new 会加载，之后重播只需 currentTime=0，避免每次重新解码。
 */
const audioPool = new Map<SoundKind, HTMLAudioElement>()
const SOUND_FILES: Record<SoundKind, string> = {
  up: 'alert-up.wav', down: 'alert-down.wav', time: 'alert-time.wav', update: 'update.wav',
}
function soundUrl(kind: SoundKind): string {
  const name = SOUND_FILES[kind]
  return location.protocol === 'file:' ? `pt-resource://sounds/${name}` : `/sounds/${name}`
}
function playSound(kind: SoundKind): void {
  try {
    let a = audioPool.get(kind)
    if (!a) {
      a = new Audio(soundUrl(kind))
      audioPool.set(kind, a)
    }
    a.currentTime = 0
    // play() 返回 Promise；自动播放被浏览器策略拦下时静默忽略，不影响提醒主流程
    void a.play().catch(() => { /* autoplay 被拒或音频不可用：静默 */ })
  } catch { /* 音频不可用不影响提醒 */ }
}

const latest = ref<QuoteSnapshot[]>([])

/**
 * 收益胶囊：盘中显示实时收益（liveDayPnl），收盘后显示定格收益（dayPnl），两者互斥。
 * 各自受 livePnlEnabled / pnlChipEnabled 开关控制；没填持仓或不在对应时段时为 null。
 */
const pnlChip = computed<{ text: string; tone: 'up' | 'down' | 'flat' } | null>(() => {
  // 提醒进行中让位给气泡：三个气泡 + 胶囊会把小熊头顶挤满
  if (state.value.reason === 'alert') return null
  const live = state.value.liveDayPnl
  const closed = state.value.dayPnl
  // 盘中实时优先：有实时值且开关开
  if (livePnlEnabled.value && typeof live === 'number' && Number.isFinite(live)) {
    return formatChip(live, '实时')
  }
  // 收盘定格：有定格值且开关开
  if (pnlChipEnabled.value && typeof closed === 'number' && Number.isFinite(closed)) {
    return formatChip(closed, '今日')
  }
  return null
})

function formatChip(v: number, label: string): { text: string; tone: 'up' | 'down' | 'flat' } {
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  return {
    text: `${label} ${sign}${Math.abs(v).toFixed(2)} 元`,
    // 红涨绿跌（A 股习惯），与气泡/托盘角标保持一致
    tone: v > 0 ? 'up' : v < 0 ? 'down' : 'flat',
  }
}

/** 根据常显开关配置轮播定时器 */
function configureTicker(): void {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  // 先清理已有常显气泡
  bubbles.value = bubbles.value.filter((b) => b.id !== alwaysBubbleId)

  if (bubbleAlwaysOn.value) {
    // 常显：每 5 秒按自选列表顺序切换下一只，气泡不消失
    updateAlwaysBubble()
    tickTimer = setInterval(() => {
      if (!latest.value.length) return
      carouselIndex = (carouselIndex + 1) % latest.value.length
      updateAlwaysBubble()
    }, 5_000)
  } else {
    // 普通模式：每 30 秒随机弹一只，3 秒后消失（不打扰）
    tickTimer = setInterval(() => {
      const s = latest.value
      if (!s.length || document.hidden) return
      const pick = s[Math.floor(Math.random() * s.length)]
      if (pick.changePct === null) return
      pushBubble({
        kind: 'tick',
        text: `${pick.name} ${fmtPct(pick.changePct)}`,
        tone: pick.changePct > 0 ? 'up' : pick.changePct < 0 ? 'down' : 'neutral',
      }, 3000)
    }, 30_000)
  }
}

/** 更新/创建常显气泡，显示当前游标指向的自选 */
function updateAlwaysBubble(): void {
  if (sleeping.value) return   // 睡觉时不常显，醒来由 watch 补回
  const list = latest.value
  if (!list.length) return
  if (carouselIndex >= list.length) carouselIndex = 0
  const pick = list[carouselIndex]
  const text = `${pick.name} ${fmtPct(pick.changePct)}`
  const tone = pick.changePct === null ? 'neutral' : pick.changePct > 0 ? 'up' : pick.changePct < 0 ? 'down' : 'neutral'
  const existing = bubbles.value.find((b) => b.id === alwaysBubbleId)
  if (existing) {
    existing.text = text
    existing.tone = tone
  } else {
    bubbles.value.push({ id: alwaysBubbleId, kind: 'tick', text, tone })
  }
}

function fmtPct(p: number | null): string {
  return p === null ? '--' : `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
}

function pushBubble(b: Omit<Bubble, 'id'>, ttlMs: number): void {
  // 睡觉期间不弹行情/系统气泡；提醒类仍入队，醒来（提醒会立刻把状态切成 panic-*）即可见
  if (sleeping.value && b.kind !== 'alert') return
  const bubble = { ...b, id: bubbleSeq++ }
  bubbles.value.push(bubble)
  if (bubbles.value.length > 3) bubbles.value.shift()
  setTimeout(() => dismiss(bubble.id), ttlMs)
}

function dismiss(id: number): void {
  bubbles.value = bubbles.value.filter((x) => x.id !== id)
}

function onOpenPanel(): void {
  api.panelOpen()
}

onBeforeUnmount(() => { if (tickTimer) clearInterval(tickTimer) })

// 进入躺睡：清掉已有气泡（提醒类保留，醒来即可见）；醒来：常显模式立刻补回行情气泡
watch(sleeping, (asleep) => {
  if (asleep) {
    bubbles.value = bubbles.value.filter((b) => b.kind === 'alert')
    return
  }
  if (bubbleAlwaysOn.value) updateAlwaysBubble()
})
</script>

<style scoped>
.pet-root {
  position: relative;
  width: 160px;
  /* 210(Pixi 画布/角色) + 44(底部新闻跑马灯)，与主进程 PET_H 保持一致 */
  height: 254px;
}
/* 躺睡时整层气泡淡出并禁止点击（醒来淡入），做过渡避免生硬消失 */
.pet-root :deep(.bubble-layer) {
  transition: opacity 0.25s ease;
}
.pet-root :deep(.bubble-layer.bubble-hidden) {
  opacity: 0;
  pointer-events: none;
}
/* 收益胶囊占用了顶部空间：气泡整体下移，避免和胶囊叠在一起 */
.pet-root.has-pnl :deep(.bubble-layer) {
  top: 28px;
}

/* 今日收益胶囊（收盘后常驻，透明窗口里靠半透明底保证可读） */
.pnl-chip {
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  max-width: 156px;
  padding: 2px 8px;
  border-radius: 9px;
  background: rgba(20, 24, 30, 0.84);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font: 600 10px/1.35 'Segoe UI', 'Microsoft YaHei', sans-serif;
  white-space: nowrap;
  pointer-events: none;
  color: #ff7b7b;
}
.pnl-chip.down { color: #6fd96f; }
.pnl-chip.flat { color: #d0d0d6; }
</style>
