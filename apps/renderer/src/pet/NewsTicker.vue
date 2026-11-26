<template>
  <div class="news-ticker" :class="{ 'no-news': !lines.length }" @pointerdown="onDragStart">
    <span class="ticker-badge">快讯</span>
    <div class="ticker-viewport">
      <div v-if="lines.length" class="ticker-track" :style="{ animationDuration: duration }">
        <!-- 两份相同内容首尾相接，滚到 -50% 正好无缝衔接 -->
        <span v-for="k in 2" :key="k" class="ticker-run">{{ tickerText }}</span>
      </div>
      <span v-else class="ticker-empty">暂无快讯</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api'
import type { NewsItem } from '@shared/index'

/** 与主进程新闻缓存节奏一致：每 5 分钟拉一次（getNews 内部有 5 分钟 TTL，不会重复打接口） */
const REFRESH_MS = 5 * 60_000
/** 展示条数：最新 N 条标题轮播 */
const MAX_LINES = 15

const items = ref<NewsItem[]>([])
let timer: ReturnType<typeof setInterval> | null = null

const lines = computed(() => items.value.slice(0, MAX_LINES).map((n) => `${shortTime(n.time)} ${n.title}`))
/** 两条内容拼接，条目之间用间隔符；末尾留白让首尾衔接不突兀 */
const tickerText = computed(() => (lines.value.length ? `${lines.value.join('  ·  ')}  ·  ` : ''))
/** 每条约 3.2 秒读完，设下限避免只有一两条时滚太快 */
const duration = computed(() => `${Math.max(12, lines.value.length * 3.2).toFixed(1)}s`)

/** 2026-11-20 07:31:41 → 07:31 */
function shortTime(t: string): string {
  const m = /(\d{2}:\d{2})/.exec(t)
  return m ? m[1] : ''
}

async function load(): Promise<void> {
  try {
    const r = await api.newsFetch(false)
    if (r?.items?.length) items.value = r.items
  } catch { /* 拉取失败保留上一次内容，跑马灯不中断 */ }
}

onMounted(() => {
  void load()
  timer = setInterval(() => { void load() }, REFRESH_MS)
})
onBeforeUnmount(() => {
  if (timer) { clearInterval(timer); timer = null }
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
})

/* 跑马灯用 no-drag 才能让真实鼠标触发 :hover 暂停（drag 区被 OS 接管，渲染层收不到 hover）。
   为保住「整条可拖动窗口」，这里用 JS 拖拽：pointermove + petNudge，与 PetStage 中心命中区同款。 */
let dragging = false
function onDragStart(e: PointerEvent): void {
  if (e.button !== 0) return
  dragging = true
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  window.addEventListener('pointercancel', onDragEnd)
}
function onDragMove(e: PointerEvent): void {
  if (!dragging) return
  const dx = e.movementX || 0
  const dy = e.movementY || 0
  if (Math.abs(dx) > 100 || Math.abs(dy) > 100) return
  if (Math.abs(dx) + Math.abs(dy) > 1) api.petNudge(dx, dy).catch(() => {})
}
function onDragEnd(): void {
  dragging = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
}
</script>

<style scoped>
/* 44px 高（与主进程 NEWS_TICKER_H 一致），贴在桌宠画布下方 */
.news-ticker {
  position: relative;
  width: 160px;
  height: 44px;
  box-sizing: border-box;
  padding: 8px 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  /* 必须是 no-drag：drag 区由系统窗口管理器接管，真实鼠标进入时渲染层收不到 :hover，
     暂停滚动就失效。拖动改由上方 pointerdown/move + petNudge 实现。 */
  -webkit-app-region: no-drag;
  app-region: no-drag;
  user-select: none;
}
.ticker-badge {
  flex: none;
  padding: 2px 4px;
  border-radius: 4px;
  background: rgba(11, 100, 214, 0.9);
  color: #fff;
  font: 600 10px/1.2 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
.ticker-viewport {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  height: 28px;
  display: flex;
  align-items: center;
  border-radius: 6px;
  background: rgba(20, 24, 30, 0.84);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.ticker-track {
  display: flex;
  flex: none;
  white-space: nowrap;
  width: max-content;
  animation-name: ticker-scroll;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
/* 鼠标悬停在跑马灯上时暂停滚动，方便看清某条快讯 */
.news-ticker:hover .ticker-track {
  animation-play-state: paused;
}
.ticker-run {
  flex: none;
  padding-right: 24px;
  color: #f2f2f7;
  font: 11px/28px 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
.ticker-empty {
  padding: 0 8px;
  color: #9a9aa2;
  font: 11px/28px 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
@keyframes ticker-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
</style>
