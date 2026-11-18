<template>
  <div class="kline-popover" :style="popStyle"
       @mouseenter="$emit('stay')" @mouseleave="$emit('leave')" @mousedown="$emit('stay')">
    <div class="head">
      <span class="title">{{ name }} <span class="code">{{ code }}</span></span>
      <div class="tabs">
        <button v-for="p in periods" :key="p.klt" :class="{ active: current === p.klt }" @click="switchPeriod(p.klt)">
          {{ p.label }}
        </button>
      </div>
    </div>
    <div class="chart-wrap">
      <div class="chart-host" ref="chartHost"></div>
      <div v-if="loading" class="state">加载中…</div>
      <div v-if="error" class="state err">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { CandlestickChart, BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, AxisPointerComponent, LegendComponent, DataZoomInsideComponent } from 'echarts/components'
import type { DataZoomComponentOption } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { api } from '../../api'
import type { KlinePoint, TrendsResult } from '@shared/index'
import { calcMACD, calcKDJ } from './indicators'

echarts.use([CandlestickChart, BarChart, LineChart, GridComponent, TooltipComponent, AxisPointerComponent, LegendComponent, DataZoomInsideComponent, CanvasRenderer])

const props = defineProps<{
  secId: string
  name: string
  code: string
  x: number   // 相对 viewport 的坐标
  y: number
}>()
defineEmits<{ (e: 'stay'): void; (e: 'leave'): void }>()

const periods = [
  { label: '分时', klt: 0 },
  { label: '5分', klt: 5 }, { label: '15分', klt: 15 },
  { label: '30分', klt: 30 }, { label: '60分', klt: 60 },
  { label: '日线', klt: 101 }, { label: '周线', klt: 102 }, { label: '月线', klt: 103 },
]
const current = ref(101)
const loading = ref(false)
const error = ref('')
const chartHost = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null
let data: KlinePoint[] = []
let trendsData: TrendsResult | null = null
const isTrends = computed(() => current.value === 0)

const POP_W = 600
const POP_H = 460
/** 标题栏高度（.titlebar 是 -webkit-app-region: drag 拖拽区） */
const TITLEBAR_H = 38
/** 浮层顶部最小留白：必须落在拖拽区下方，否则浮层里的按钮点不动/会拖动窗口 */
const TOP_MIN = TITLEBAR_H + 8

/**
 * 在鼠标位置附近弹出：默认右下，空间不足时自动翻到左侧/上方，
 * 并夹紧在窗口内，避免遮挡被 hover 的那一行。
 * 注意：顶部不能压到标题栏拖拽区，否则标签按钮的按下会被系统当成拖动窗口，
 * 导致点击丢失、浮层被拖没（用户反馈"移到分时图界面就关闭"）。
 */
const popStyle = computed(() => {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 窗口较矮时压缩高度，保证整块浮层都在拖拽区之下
  const h = Math.max(260, Math.min(POP_H, vh - TOP_MIN - 8))
  let x = props.x + 14
  let y = props.y + 14
  if (x + POP_W + 8 > vw) x = props.x - POP_W - 14
  if (y + h + 8 > vh) y = props.y - h - 14
  x = Math.min(Math.max(8, x), Math.max(8, vw - POP_W - 8))
  y = Math.min(Math.max(TOP_MIN, y), Math.max(TOP_MIN, vh - h - 8))
  return {
    left: `${x}px`, top: `${y}px`,
    width: `${POP_W}px`, height: `${h}px`,
  }
})

onMounted(async () => {
  window.addEventListener('resize', onResize)
  await load()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})

function onResize(): void { chart?.resize() }

async function switchPeriod(klt: number): Promise<void> {
  if (current.value === klt) return
  current.value = klt
  await load()
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    if (isTrends.value) {
      trendsData = await api.trendsFetch(props.secId)
      if (!trendsData.trends.length) { error.value = '暂无分时数据'; return }
    } else {
      data = await api.klineFetch(props.secId, current.value, 120)
      if (!data.length) { error.value = '暂无K线数据'; return }
    }
    await nextTick()
    if (!chartHost.value) return
    if (!chart) chart = echarts.init(chartHost.value, undefined, { renderer: 'canvas' })
    else chart.resize()
    if (isTrends.value) renderTrends()
    else render()
  } catch (e) {
    error.value = '加载失败：' + (e as Error).message
  } finally {
    loading.value = false
  }
}

/** 分时图：价格线/均价线/昨收基准 + 成交量 + MACD + KDJ */
function renderTrends(): void {
  if (!chart || !trendsData) return
  const t = trendsData.trends
  const cats = t.map((p) => p.time.slice(11) || p.time)   // 只取 HH:mm
  const prices = t.map((p) => roundNum(p.price, 2))
  const avgs = t.map((p) => roundNum(p.avg, 2))
  const preClose = trendsData.preClose
  // 分时涨跌幅基准：以昨收为中心对称的价格轴（取 2 位小数，避免轴上出现一长串小数）
  const maxDev = Math.max(...prices.map((p) => Math.abs(p - preClose)), 0.01)
  const axisPad = maxDev * 1.15
  const axisMin = roundNum(preClose - axisPad, 2)
  const axisMax = roundNum(preClose + axisPad, 2)

  const vols = t.map((p, i) => ({
    value: p.volume,
    itemStyle: { color: i === 0 || p.price >= t[i - 1].price ? '#d70015' : '#248a3d' },
  }))
  // 分时序列的 MACD/KDJ：用价格构造等价 high/low（分时点的高低即价格本身）
  const macd = calcMACD(prices)
  const kdj = calcKDJ(prices, prices, prices)
  const dif = macd.map((m) => roundOpt(m.dif, 3))
  const dea = macd.map((m) => roundOpt(m.dea, 3))
  const macdBars = macd.map((m) => ({
    value: roundOpt(m.macd, 3),
    itemStyle: { color: (m.macd ?? 0) >= 0 ? '#d70015' : '#248a3d' },
  }))

  // 分时固定时间轴刻度：午休段接口在 11:30 后直接跳到 13:01，没有 13:00 这一分钟，
  // 因此午间刻度合并标注为「11:30/13:00」（与东财一致），避免两个标签挤在一起。
  const tickLabels = buildTimeTickLabels(cats)

  chart.setOption({
    animation: false,
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, confine: true },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    dataZoom: zoomOption(12),
    grid: [
      { left: 56, right: 16, top: 8, height: '40%' },
      { left: 56, right: 16, top: '50%', height: '10%' },
      { left: 56, right: 16, top: '63%', height: '13%' },
      { left: 56, right: 16, top: '80%', height: '16%' },
    ],
    xAxis: [
      { type: 'category', data: cats, gridIndex: 0, boundaryGap: false,
        axisLabel: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { opacity: 0.3 } } },
      { type: 'category', data: cats, gridIndex: 1, boundaryGap: false, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', data: cats, gridIndex: 2, boundaryGap: false, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', data: cats, gridIndex: 3, boundaryGap: false,
        axisLabel: { fontSize: 10, interval: 0, formatter: (_v: string, i: number) => tickLabels.get(i) ?? '' } },
    ],
    yAxis: [
      { gridIndex: 0, min: axisMin, max: axisMax,
        splitLine: { show: true, lineStyle: { opacity: 0.1 } },
        axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(2) } },
      { gridIndex: 1, min: 0, splitLine: { show: false },
        name: '量(手)', nameLocation: 'end', nameGap: 2, nameTextStyle: { fontSize: 9, align: 'left' },
        splitNumber: 2,
        axisLabel: { fontSize: 9, formatter: (v: number) => fmtHands(v) } },
      { gridIndex: 2, scale: true, splitLine: { show: false }, axisLabel: { fontSize: 9, formatter: (v: number) => v.toFixed(1) } },
      { gridIndex: 3, scale: true, splitLine: { show: false }, axisLabel: { fontSize: 9, formatter: (v: number) => v.toFixed(0) } },
    ],
    series: [
      { name: '价格', type: 'line', data: prices, xAxisIndex: 0, yAxisIndex: 0,
        showSymbol: false, smooth: false, lineStyle: { width: 1.5, color: '#0a84ff' },
        areaStyle: { color: 'rgba(10,132,255,0.08)' },
        markLine: { silent: true, symbol: 'none', label: { show: false },
          lineStyle: { color: '#888', type: 'dashed', width: 1 }, data: [{ yAxis: preClose }] } },
      { name: '均价', type: 'line', data: avgs, xAxisIndex: 0, yAxisIndex: 0,
        showSymbol: false, lineStyle: { width: 1, color: '#f0c020' } },
      { name: '成交量', type: 'bar', data: vols, xAxisIndex: 1, yAxisIndex: 1 },
      { name: 'DIF', type: 'line', data: dif, xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, lineStyle: { width: 1, color: '#f0c020' } },
      { name: 'DEA', type: 'line', data: dea, xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, lineStyle: { width: 1, color: '#0a84ff' } },
      { name: 'MACD', type: 'bar', data: macdBars, xAxisIndex: 2, yAxisIndex: 2 },
      { name: 'K', type: 'line', data: kdj.map((p) => roundOpt(p.k, 2)), xAxisIndex: 3, yAxisIndex: 3, showSymbol: false, lineStyle: { width: 1, color: '#ff6b6b' } },
      { name: 'D', type: 'line', data: kdj.map((p) => roundOpt(p.d, 2)), xAxisIndex: 3, yAxisIndex: 3, showSymbol: false, lineStyle: { width: 1, color: '#57d38c' } },
      { name: 'J', type: 'line', data: kdj.map((p) => roundOpt(p.j, 2)), xAxisIndex: 3, yAxisIndex: 3, showSymbol: false, lineStyle: { width: 1, color: '#b088f0' } },
    ],
  }, true)
}

function render(): void {
  if (!chart || !data.length) return
  const cats = data.map((d) => d.time)
  const ohlc = data.map((d) => [roundNum(d.open, 2), roundNum(d.close, 2), roundNum(d.low, 2), roundNum(d.high, 2)])
  const vols = data.map((d) => ({
    value: d.volume,
    itemStyle: { color: d.close >= d.open ? '#d70015' : '#248a3d' },
  }))
  const macd = calcMACD(data.map((d) => d.close))
  const kdj = calcKDJ(data.map((d) => d.high), data.map((d) => d.low), data.map((d) => d.close))
  const dif = macd.map((m) => roundOpt(m.dif, 3))
  const dea = macd.map((m) => roundOpt(m.dea, 3))
  const macdBars = macd.map((m) => ({
    value: roundOpt(m.macd, 3),
    itemStyle: { color: (m.macd ?? 0) >= 0 ? '#d70015' : '#248a3d' },
  }))
  const kLines = kdj.map((p) => roundOpt(p.k, 2))
  const dLines = kdj.map((p) => roundOpt(p.d, 2))
  const jLines = kdj.map((p) => roundOpt(p.j, 2))

  chart.setOption({
    animation: false,
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      confine: true,
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    dataZoom: zoomOption(5),
    grid: [
      { left: 56, right: 16, top: 8, height: '40%' },
      { left: 56, right: 16, top: '50%', height: '10%' },
      { left: 56, right: 16, top: '63%', height: '13%' },
      { left: 56, right: 16, top: '80%', height: '16%' },
    ],
    xAxis: [
      { type: 'category', data: cats, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', data: cats, gridIndex: 1, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', data: cats, gridIndex: 2, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', data: cats, gridIndex: 3, axisLabel: { fontSize: 10, interval: Math.max(1, Math.floor(cats.length / 6)) } },
    ],
    yAxis: [
      { scale: true, gridIndex: 0, splitLine: { show: true, lineStyle: { opacity: 0.1 } },
        axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(2) } },
      { gridIndex: 1, min: 0, splitLine: { show: false },
        name: '量(手)', nameLocation: 'end', nameGap: 2, nameTextStyle: { fontSize: 9, align: 'left' },
        splitNumber: 2,
        axisLabel: { fontSize: 9, formatter: (v: number) => fmtHands(v) } },
      { scale: true, gridIndex: 2, splitLine: { show: false }, axisLabel: { fontSize: 9, formatter: (v: number) => v.toFixed(1) } },
      { scale: true, gridIndex: 3, splitLine: { show: false }, axisLabel: { fontSize: 9, formatter: (v: number) => v.toFixed(0) } },
    ],
    series: [
      { name: 'K线', type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
        itemStyle: { color: '#d70015', color0: '#248a3d', borderColor: '#d70015', borderColor0: '#248a3d' } },
      { name: '成交量', type: 'bar', data: vols, xAxisIndex: 1, yAxisIndex: 1 },
      { name: 'DIF', type: 'line', data: dif, xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, lineStyle: { width: 1, color: '#f0c020' }, itemStyle: { color: '#f0c020' } },
      { name: 'DEA', type: 'line', data: dea, xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, lineStyle: { width: 1, color: '#0a84ff' }, itemStyle: { color: '#0a84ff' } },
      { name: 'MACD', type: 'bar', data: macdBars, xAxisIndex: 2, yAxisIndex: 2 },
      { name: 'K', type: 'line', data: kLines, xAxisIndex: 3, yAxisIndex: 3, showSymbol: false, lineStyle: { width: 1, color: '#ff6b6b' }, itemStyle: { color: '#ff6b6b' } },
      { name: 'D', type: 'line', data: dLines, xAxisIndex: 3, yAxisIndex: 3, showSymbol: false, lineStyle: { width: 1, color: '#57d38c' }, itemStyle: { color: '#57d38c' } },
      { name: 'J', type: 'line', data: jLines, xAxisIndex: 3, yAxisIndex: 3, showSymbol: false, lineStyle: { width: 1, color: '#b088f0' }, itemStyle: { color: '#b088f0' } },
    ],
  }, true)
}

watch(() => props.secId, () => load())

/* ---------- 坐标轴辅助 ---------- */

/**
 * 鼠标滚轮缩放：滚轮向上放大、向下缩小，按住拖动可左右平移。
 * 只作用于 X 轴（各个 grid 联动），minValueSpan 限制最小可见点数，避免放大成空白。
 */
function zoomOption(minSpan: number): DataZoomComponentOption[] {
  return [
    {
      type: 'inside',
      xAxisIndex: [0, 1, 2, 3],
      start: 0,
      end: 100,
      minValueSpan: minSpan,
      zoomOnMouseWheel: true,
      moveOnMouseWheel: false,
      moveOnMouseMove: true,
      preventDefaultMouseMove: true,
    },
  ]
}

/** 四舍五入到 n 位小数（展示用，避免坐标轴/tooltip 出现一长串浮点尾数） */
function roundNum(v: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

/** 同 roundNum，但允许 null（指标前段为空） */
function roundOpt(v: number | null, digits: number): number | null {
  return v == null ? null : roundNum(v, digits)
}

/** 分时 X 轴刻度：午休段没有 13:00 这一分钟（11:30 后直接 13:01），午间合并为一个标签 */
const TIME_TICKS: ReadonlyArray<readonly [string, string]> = [
  ['09:30', '09:30'], ['10:30', '10:30'], ['11:30', '11:30/13:00'],
  ['14:00', '14:00'], ['15:00', '15:00'],
]

function timeToMinutes(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN
}

/** 刻度时间 → 数据下标（找不到精确分钟时取最接近的点，例如 13:00 → 13:01） */
function buildTimeTickLabels(cats: string[]): Map<number, string> {
  const labels = new Map<number, string>()
  for (const [at, label] of TIME_TICKS) {
    let idx = cats.indexOf(at)
    if (idx < 0) {
      const target = timeToMinutes(at)
      let bestDist = Number.POSITIVE_INFINITY
      cats.forEach((c, i) => {
        const d = Math.abs(timeToMinutes(c) - target)
        if (Number.isFinite(d) && d < bestDist) { bestDist = d; idx = i }
      })
    }
    if (idx >= 0) labels.set(idx, label)
  }
  return labels
}

/** 成交量刻度：单位手，过万显示「万」 */
function fmtHands(v: number): string {
  if (!Number.isFinite(v)) return ''
  const a = Math.abs(v)
  if (a >= 1e8) return (v / 1e8).toFixed(1) + '亿'
  if (a >= 1e4) return (v / 1e4).toFixed(0) + '万'
  return String(Math.round(v))
}

</script>

<style scoped>
.kline-popover {
  position: fixed; z-index: 999;
  /* 防御：浮层内点击绝不能被窗口标题栏的拖拽区吞掉 */
  -webkit-app-region: no-drag;
  app-region: no-drag;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 12px 36px rgba(0,0,0,0.28);
  display: flex; flex-direction: column; overflow: hidden;
}
.head { padding: 8px 12px; border-bottom: 1px solid var(--border-soft); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.title { font-weight: 600; font-size: 13px; }
.code { color: var(--text-tertiary); font-size: 11px; font-weight: 400; margin-left: 4px; }
.tabs { display: flex; gap: 2px; margin-left: auto; }
.tabs button {
  padding: 3px 8px; font-size: 11px; border: none; border-radius: 5px;
  background: transparent; color: var(--text-secondary); cursor: pointer;
}
.tabs button:hover { background: var(--hover); }
.tabs button.active { background: var(--accent); color: #fff; }
.chart-wrap { flex: 1; min-height: 0; position: relative; }
/* chart-host 始终有尺寸（不能用 v-show 隐藏，否则 ECharts 初始化得到 0 宽画布） */
.chart-host { position: absolute; inset: 0; }
.state {
  position: absolute; inset: 0; display: grid; place-items: center;
  color: var(--text-tertiary); font-size: 12px; background: var(--surface);
}
.state.err { color: #d70015; }
</style>
