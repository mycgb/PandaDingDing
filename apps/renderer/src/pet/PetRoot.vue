<template>
  <div class="pet-root">
    <PetStage ref="stage" :state="state" :skin="skin" @open-panel="onOpenPanel" />
    <BubbleLayer :class="{ 'bubble-hidden': sleeping }" :bubbles="bubbles" :bubble-color="bubbleColor"
                 :font-size="bubbleFontSize" @dismiss="dismiss" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PetStage from './PetStage.vue'
import BubbleLayer from './BubbleLayer.vue'
import { api, onPetState, onAlert, onNotice, onQuote, onSettingsChanged } from '../api'
import type { AlertEvent, PetState, QuoteSnapshot, SystemNotice, AppSettings } from '@shared/index'

const stage = ref<InstanceType<typeof PetStage>>()
const state = ref<PetState>({ action: 'idle' })
const skin = ref('mascot-cat')
const bubbleColor = ref('#14181e')
const bubbleFontSize = ref(11)
const bubbles = ref<Bubble[]>([])
const bubbleAlwaysOn = ref(false)

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
  onSettingsChanged((ns: AppSettings) => {
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

  configureTicker()
})

const latest = ref<QuoteSnapshot[]>([])

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
  height: 210px;
}
/* 躺睡时整层气泡淡出并禁止点击（醒来淡入），做过渡避免生硬消失 */
.pet-root :deep(.bubble-layer) {
  transition: opacity 0.25s ease;
}
.pet-root :deep(.bubble-layer.bubble-hidden) {
  opacity: 0;
  pointer-events: none;
}
</style>
