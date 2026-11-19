<template>
  <section>
    <div class="toolbar">
      <input v-model="kw" placeholder="搜索代码/名称，如 600519 / 茅台 / 创业板ETF" @input="doSuggest" />
      <div v-if="suggests.length" class="suggest-box">
        <button v-for="s in suggests" :key="s.secId" @click="add(s)">
          {{ s.code }} · {{ s.name }} <span class="tag">{{ categoryLabel(s.type) }}</span>
        </button>
      </div>
      <span class="hint">Enter 全选第一项</span>
      <div class="toolbar-actions">
        <button class="mini" @click="exportList">⬇ 导出</button>
        <button class="mini" @click="triggerImport">⬆ 导入</button>
        <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onImportFile" />
      </div>
    </div>

    <!-- 持仓汇总：只统计填了股数的标的 -->
    <div v-if="total.count > 0" class="pos-summary">
      <span class="ps-item">持仓 <b>{{ total.count }}</b> 只</span>
      <span class="ps-item">市值 <b class="mono">{{ fmtMoney(total.marketValue) }}</b></span>
      <span class="ps-item">成本 <b class="mono">{{ fmtMoney(total.costValue) }}</b></span>
      <span class="ps-item">当日 <b class="mono" :class="cls(total.dayPnl)">{{ fmtSigned(total.dayPnl) }}</b></span>
      <span class="ps-item">累计 <b class="mono" :class="cls(total.totalPnl)">{{ fmtSigned(total.totalPnl) }}</b></span>
    </div>

    <table class="quote-table">
      <thead>
        <tr>
          <th>#</th><th>名称</th><th>代码</th>
          <th class="sortable" @click="sortBy('price')">现价</th>
          <th class="sortable" @click="sortBy('changePct')">涨跌幅</th>
          <th>成交额</th>
          <th>持仓</th>
          <th class="sortable" @click="sortBy('dayPnl')">当日盈亏</th>
          <th>累计盈亏</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(w, i) in rows" :key="w.secId">
          <td>{{ i + 1 }}</td>
          <td><span class="name-hover" @mouseenter="onNameEnter($event, w)" @mouseleave="onNameLeave">{{ w.name }}</span></td>
          <td class="mono">{{ w.code }}</td>
          <td class="mono">{{ fmt(w.price) }}</td>
          <td class="mono" :class="cls(w.changePct)">{{ fmtPct(w.changePct) }}</td>
          <td class="mono">{{ fmtAmount(w.amount) }}</td>
          <td>
            <button v-if="!w.pos" class="mini ghost" @click="editPos(w)">＋ 记持仓</button>
            <button v-else class="pos-cell" @click="editPos(w)">
              <span class="pos-shares">{{ w.shares }} 股</span>
              <span class="pos-cost">成本 {{ w.costPrice > 0 ? w.costPrice.toFixed(2) : '未填' }}</span>
            </button>
          </td>
          <td class="mono" :class="cls(w.pos?.dayPnl ?? null)">
            <template v-if="w.pos">{{ fmtSigned(w.pos.dayPnl) }}</template>
            <span v-else class="dim">--</span>
          </td>
          <td class="mono" :class="cls(w.pos?.totalPnl ?? null)">
            <template v-if="w.pos && w.costPrice > 0">{{ fmtSigned(w.pos.totalPnl) }}</template>
            <span v-else class="dim">--</span>
          </td>
          <td>
            <button class="mini" @click="remove(w.secId)">移除</button>
          </td>
        </tr>
        <tr v-if="rows.length === 0"><td colspan="10" class="empty">暂无自选，先搜索添加吧</td></tr>
      </tbody>
    </table>

    <!-- 持仓编辑：点「持仓」单元格展开 -->
    <div v-if="editingPos" class="pos-editor">
      <h3>{{ editingPos.name }}（{{ editingPos.code }}）持仓</h3>
      <div class="pos-form">
        <label>股数
          <input v-model.number="posShares" type="number" min="0" step="100" />
        </label>
        <label>成本价
          <input v-model.number="posCost" type="number" min="0" step="0.001" />
        </label>
        <div class="pos-btns">
          <button class="primary" @click="savePos">保存</button>
          <button @click="editingPos = null">取消</button>
        </div>
      </div>
      <p class="hint">股数填 0 = 只观察、不计盈亏；成本价留 0 = 只算当日盈亏，不算累计。</p>
    </div>

    <!-- K线浮层：Teleport 到 body 避免被窗口 overflow 裁切 -->
    <!-- 不用 Teleport：position:fixed 相对视口定位，不受父容器 overflow 裁切；
         留在组件内还能正常继承 .panel-root 上的主题 CSS 变量 -->
    <KlinePopover v-if="hoverKline"
                  :sec-id="hoverKline.secId" :name="hoverKline.name" :code="hoverKline.code"
                  :x="hoverKline.x" :y="hoverKline.y"
                  @stay="clearLeaveTimer" @leave="onNameLeave" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, onQuote } from '../../api'
import KlinePopover from '../chart/KlinePopover.vue'
import { isOtcFund, calcPosition, sumPositions } from '@shared/index'
import type { QuoteSnapshot, SuggestItem, WatchItem, AssetCategory, PositionStats } from '@shared/index'

const kw = ref('')
const suggests = ref<SuggestItem[]>([])
const watchlist = ref<WatchItem[]>([])
const quotes = ref(new Map<string, QuoteSnapshot>())
const sortKey = ref<string | null>(null)
const sortDesc = ref(true)
const fileInput = ref<HTMLInputElement | null>(null)

/** 持仓编辑态 */
const editingPos = ref<WatchItem | null>(null)
const posShares = ref(0)
const posCost = ref(0)

let suggestTimer: ReturnType<typeof setTimeout> | null = null
let offQuote: (() => void) | null = null

/** K线浮层 hover 状态 */
const hoverKline = ref<{ secId: string; name: string; code: string; x: number; y: number } | null>(null)
let hoverTimer: ReturnType<typeof setTimeout> | null = null
let leaveTimer: ReturnType<typeof setTimeout> | null = null

function onNameEnter(e: MouseEvent, w: WatchItem): void {
  clearHoverTimers()
  // 场外基金是净值型，无 K 线/分时数据
  if (isOtcFund(w.market)) return
  // 用鼠标实际位置作锚点：浮层出现在光标右下（空间不足自动翻转）
  const x = e.clientX
  const y = e.clientY
  hoverTimer = setTimeout(() => {
    hoverKline.value = { secId: w.secId, name: w.name, code: w.code, x, y }
  }, 350)
}
function onNameLeave(): void {
  clearHoverTimers()
  // 给鼠标从表格行移到浮层的间隙留 500ms（浮层在行下方 14px，留足反应时间，
  // 避免还没来得及点「分时」等标签浮层就消失）
  leaveTimer = setTimeout(() => { hoverKline.value = null }, 500)
}
function clearLeaveTimer(): void {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null }
}
function clearHoverTimers(): void {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
  clearLeaveTimer()
}

onMounted(async () => {
  watchlist.value = await api.watchlistList()
  quotes.value = new Map((await api.quoteLatest()).map((q) => [q.secId, q]))
  offQuote = onQuote((snaps) => {
    for (const s of snaps) quotes.value.set(s.secId, s)
    quotes.value = new Map(quotes.value)  // 触发响应式
  })
})
onBeforeUnmount(() => { offQuote?.(); clearHoverTimers() })

function doSuggest(): void {
  if (suggestTimer) clearTimeout(suggestTimer)
  suggestTimer = setTimeout(async () => {
    if (!kw.value.trim()) { suggests.value = []; return }
    try { suggests.value = await api.searchSuggest(kw.value.trim()) } catch { suggests.value = [] }
  }, 250)
}

async function add(s: SuggestItem): Promise<void> {
  // 允许的市场号：A股0/1、美股105/106/107、港股116、场外基金150
  if (![0, 1, 105, 106, 107, 116, 150].includes(s.market)) {
    alert(`暂不支持添加「${s.name}」（市场号 ${s.market}）`)
    return
  }
  try {
    await api.watchlistAdd(s.secId, s.name, s.market)
    watchlist.value = await api.watchlistList()
    suggests.value = []; kw.value = ''
  } catch (e) {
    alert('添加失败：' + (e as Error).message)
  }
}

async function remove(secId: string): Promise<void> {
  await api.watchlistRemove(secId)
  watchlist.value = watchlist.value.filter((w) => w.secId !== secId)
}

/** 导出自选为 JSON 文件（股票代码、市场、名称、权重） */
function exportList(): void {
  const data = watchlist.value.map((w) => ({
    secId: w.secId, code: w.code, name: w.name, market: w.market, weight: w.weight,
    shares: w.shares, costPrice: w.costPrice,
  }))
  if (data.length === 0) { alert('自选列表为空，无可导出内容'); return }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  a.href = url
  a.download = `pandadingding-watchlist-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** 触发文件选择 */
function triggerImport(): void {
  fileInput.value?.click()
}

/** 从 JSON 文件导入自选（跳过已存在的，逐条添加并汇总结果） */
async function onImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''   // 允许重复导入同一文件
  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) throw new Error('文件格式错误：应为 JSON 数组')
    const items = parsed.filter((x): x is Record<string, unknown> =>
      !!x && typeof x === 'object' && typeof x.secId === 'string')
    if (items.length === 0) throw new Error('文件中没有有效的自选条目')

    let added = 0, skipped = 0, failed = 0
    for (const item of items) {
      const secId = item.secId as string
      const code = typeof item.code === 'string' ? item.code : secId.split('.')[1]
      const name = typeof item.name === 'string' ? item.name : code
      // 市场号从 secId 前缀推导（兼容旧导出文件 market 缺失/错误的情况）
      const mktFromId = Number(String(secId).split('.')[0])
      const market = ([0, 1, 105, 106, 107, 116, 150].includes(mktFromId)
        ? mktFromId : Number(item.market) || 0) as import('@shared/index').MarketType
      try {
        await api.watchlistAdd(secId, name, market)
        // 带持仓的导出文件：导入时一并恢复股数与成本
        const sh = Number(item.shares) || 0
        const cp = Number(item.costPrice) || 0
        if (sh > 0) await api.watchlistSetPosition(secId, sh, cp)
        added++
      } catch (err) {
        const msg = (err as Error).message
        // IPC 抛错会被 Electron 包装成 "Error invoking remote method '...': Error: DUPLICATE"
        if (msg.includes('DUPLICATE')) skipped++
        else failed++
      }
    }
    watchlist.value = await api.watchlistList()
    alert(`导入完成：新增 ${added}，已存在跳过 ${skipped}，失败 ${failed}`)
  } catch (err) {
    alert('导入失败：' + (err as Error).message)
  }
}

type Row = WatchItem & {
  price: number | null
  changePct: number | null
  amount: number | null
  pos: PositionStats | null
}

const rows = computed((): Row[] => {
  const base: Row[] = watchlist.value.map((w) => {
    const q = quotes.value.get(w.secId)
    const price = q?.price ?? null
    const prevClose = q?.prevClose ?? null
    return {
      ...w,
      price,
      changePct: q?.changePct ?? null,
      amount: q?.amount ?? null,
      pos: calcPosition({ shares: w.shares, costPrice: w.costPrice, price, prevClose }),
    }
  })
  const k = sortKey.value
  if (!k) return base
  const pick = (r: Row): number | null =>
    k === 'dayPnl' ? (r.pos?.dayPnl ?? null) : ((r[k as keyof Row] as number | null | undefined) ?? null)
  return base.sort((a, b) => {
    const av = pick(a) ?? -Infinity
    const bv = pick(b) ?? -Infinity
    return (sortDesc.value ? av < bv ? 1 : -1 : av > bv ? 1 : -1) || 0
  })
})

/** 组合持仓汇总（只统计填了股数且有现价的标的） */
const total = computed(() => sumPositions(
  rows.value.map((r) => r.pos).filter((p): p is PositionStats => !!p),
))

function sortBy(k: string): void {
  if (sortKey.value === k) sortDesc.value = !sortDesc.value
  else { sortKey.value = k; sortDesc.value = true }
}

function editPos(w: WatchItem): void {
  editingPos.value = w
  posShares.value = w.shares || 0
  posCost.value = w.costPrice || 0
}

async function savePos(): Promise<void> {
  if (!editingPos.value) return
  const shares = Number.isFinite(posShares.value) ? Math.max(0, Number(posShares.value)) : 0
  const cost = Number.isFinite(posCost.value) ? Math.max(0, Number(posCost.value)) : 0
  try {
    await api.watchlistSetPosition(editingPos.value.secId, shares, cost)
    watchlist.value = await api.watchlistList()
    editingPos.value = null
  } catch (e) {
    alert('保存持仓失败：' + (e as Error).message)
  }
}

function categoryLabel(t: AssetCategory): string {
  return ({ stock: 'A股', etf: 'ETF', hk: '港股', us: '美股', fund: '基金' } as Record<AssetCategory, string>)[t] ?? t
}
function fmt(v: number | null): string { return v === null ? '--' : v.toFixed(4) }
function fmtPct(v: number | null): string { return v === null ? '--' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }
function fmtAmount(v: number | null): string {
  if (v === null) return '--'
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
  return String(v)
}
/** 带符号金额：+1234.56 / -1234.56 */
function fmtSigned(v: number): string {
  if (!Number.isFinite(v)) return '--'
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`
}
/** 汇总用金额：过万自动换算，避免 6 位数挤爆表头 */
function fmtMoney(v: number): string {
  if (!Number.isFinite(v)) return '--'
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '万'
  return v.toFixed(0)
}
function cls(v: number | null): string {
  if (v === null) return ''
  return v > 0 ? 'up' : v < 0 ? 'down' : ''
}
</script>

<script lang="ts">
export default { name: 'WatchlistView' }
</script>

<style scoped>
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; position: relative; }
.toolbar-actions { margin-left: auto; display: flex; gap: 8px; }
.toolbar-actions .mini { padding: 5px 12px; font-size: 12px; }
.toolbar input {
  width: 340px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); outline: none;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.03);
}
.toolbar input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(11,100,214,0.15); }
.suggest-box {
  position: absolute; top: 38px; left: 0; z-index: 10; width: 360px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.suggest-box button {
  display: flex; justify-content: space-between; width: 100%; padding: 8px 12px; background: transparent;
  border: none; color: var(--text); cursor: pointer; text-align: left; font-size: 13px;
}
.suggest-box button:hover { background: var(--hover); }
.tag { font-size: 10px; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
.hint { font-size: 11px; color: var(--text-tertiary); }
.name-hover { cursor: help; border-bottom: 1px dashed transparent; }
.name-hover:hover { color: var(--accent); border-bottom-color: var(--accent); }
.quote-table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--surface); border-radius: 8px; overflow: hidden; }
.quote-table th, .quote-table td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--border-soft); }
.quote-table th { color: var(--text-secondary); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; background: var(--surface); }
.quote-table tr:last-child td { border-bottom: none; }
.quote-table tbody tr:hover { background: var(--hover); }
.quote-table th.sortable { cursor: pointer; }
.quote-table th.sortable:hover { color: var(--accent); }
.mono { font-family: 'SF Mono', 'Cascadia Mono', Consolas, monospace; font-variant-numeric: tabular-nums; }
.up { color: var(--up); }
.down { color: var(--down); }
.dim { color: var(--text-tertiary); font-size: 11px; }
.empty { text-align: center; color: var(--text-tertiary); padding: 40px; }
.mini {
  padding: 3px 10px; font-size: 11px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); cursor: pointer;
}
.mini:hover { background: var(--hover); border-color: var(--border); }
.mini.ghost { color: var(--text-tertiary); border-style: dashed; }
.mini.ghost:hover { color: var(--accent); border-color: var(--accent); }

/* 持仓汇总条 */
.pos-summary {
  display: flex; flex-wrap: wrap; gap: 18px; align-items: baseline;
  padding: 10px 14px; margin-bottom: 12px;
  background: var(--surface); border: 1px solid var(--border-soft); border-radius: 8px;
  font-size: 12px; color: var(--text-secondary);
}
.ps-item b { color: var(--text); font-weight: 600; margin-left: 2px; }
.ps-item b.up { color: var(--up); }
.ps-item b.down { color: var(--down); }

/* 持仓单元格：两行小字，点击编辑 */
.pos-cell {
  display: flex; flex-direction: column; gap: 1px; align-items: flex-start;
  background: transparent; border: none; cursor: pointer; padding: 2px 4px;
  border-radius: 6px; text-align: left; color: var(--text);
}
.pos-cell:hover { background: var(--hover); }
.pos-shares { font-size: 12px; font-family: 'SF Mono', Consolas, monospace; }
.pos-cost { font-size: 10px; color: var(--text-tertiary); }

/* 持仓编辑卡 */
.pos-editor {
  margin-top: 16px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px 18px; max-width: 460px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.pos-editor h3 { font-size: 13px; font-weight: 600; margin: 0 0 12px; }
.pos-form { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.pos-form label {
  display: flex; flex-direction: column; gap: 5px;
  font-size: 11px; color: var(--text-secondary); font-weight: 600;
}
.pos-form input {
  width: 120px; padding: 6px 9px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font-size: 13px;
}
.pos-form input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(11,100,214,0.15); }
.pos-btns { display: flex; gap: 8px; }
.pos-btns button {
  padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font-size: 13px; cursor: pointer;
}
.pos-btns button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.pos-editor .hint { margin-top: 10px; }
</style>
