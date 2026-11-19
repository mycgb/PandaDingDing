<template>
  <div class="index-bar" :class="`theme-${theme}`">
    <div v-for="i in rows" :key="i.secId" class="row">
      <span class="name">{{ i.short }}</span>
      <span class="pct" :class="tone(i.pct)">{{ fmt(i.pct) }}</span>
      <span class="track"><span class="fill" :class="tone(i.pct)" :style="{ width: barWidth(i.pct) }" /></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, onIndexQuotes } from '../api'
import { MARKET_INDICES } from '@shared/index'
import type { QuoteSnapshot } from '@shared/index'

const theme = ref<'light' | 'dark'>('light')
const quotes = ref<QuoteSnapshot[]>([])
let off: (() => void) | null = null

const rows = computed(() => MARKET_INDICES.map((m) => {
  const q = quotes.value.find((s) => s.secId === m.secId)
  return { secId: m.secId, short: m.short, pct: q?.changePct ?? null }
}))

onMounted(async () => {
  try {
    const s = await api.settingsGet()
    theme.value = (s.theme === 'dark' ? 'dark' : 'light')
  } catch { /* 用默认浅色 */ }
  try { quotes.value = await api.indexLatest() } catch { quotes.value = [] }
  off = onIndexQuotes((snaps) => { quotes.value = snaps })
  // 窗口可能在首轮轮询完成前就创建好了，此时 indexLatest 为空；补一次兜底拉取
  if (!quotes.value.length) {
    setTimeout(() => {
      api.indexLatest().then((l) => { if (l.length && !quotes.value.length) quotes.value = l }).catch(() => {})
    }, 3000)
  }
})
onBeforeUnmount(() => { off?.() })

function fmt(pct: number | null): string {
  if (pct === null || pct === undefined) return '--'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}
function tone(pct: number | null): string {
  if (pct === null || pct === undefined || pct === 0) return 'flat'
  return pct > 0 ? 'up' : 'down'
}
/** 温度条长度：±1.5% 打满，避免极端行情下条子溢出 */
function barWidth(pct: number | null): string {
  if (pct === null || pct === undefined) return '0%'
  const w = Math.min(100, (Math.abs(pct) / 1.5) * 100)
  return `${w.toFixed(0)}%`
}
</script>

<style scoped>
.index-bar {
  width: 100vw;
  height: 100vh;
  box-sizing: border-box;
  padding: 5px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(0, 0, 0, 0.06);
  font: 11px/1.2 -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  color: #1c1c1e;
  /* 整块可拖动；双击无操作，避免误触 */
  -webkit-app-region: drag;
  user-select: none;
}
.index-bar.theme-dark {
  background: rgba(28, 28, 30, 0.86);
  border-color: rgba(255, 255, 255, 0.08);
  color: #f2f2f7;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
}
.name {
  flex: 1;
  min-width: 0;
  opacity: 0.72;
  white-space: nowrap;
  overflow: hidden;
}
.pct {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  min-width: 46px;
}
.track {
  width: 22px;
  height: 4px;
  border-radius: 2px;
  background: rgba(120, 120, 128, 0.18);
  overflow: hidden;
  flex: none;
}
.fill { display: block; height: 100%; border-radius: 2px; }
.up { color: #e2453c; }
.down { color: #1ba55c; }
.fill.up { background: #e2453c; }
.fill.down { background: #1ba55c; }
.flat { color: #8e8e93; }
</style>
