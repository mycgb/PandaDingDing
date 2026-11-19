<template>
  <section class="ds-view">
    <div class="card">
      <h2>当前行情源</h2>
      <div class="status-line">
        <span class="status-dot" :class="stateTone" />
        <span class="source-name">{{ ds.source || '—' }}</span>
        <span class="state-badge" :class="stateTone">{{ stateLabel }}</span>
        <span v-if="ds.lastOkAt" class="updated">更新于 {{ timeago(ds.lastOkAt) }}</span>
      </div>
      <div class="grid">
        <div class="stat"><span class="k">主数据源</span><span class="v">{{ ds.primaryName || '东方财富' }}</span></div>
        <div class="stat"><span class="k">备用数据源</span><span class="v">{{ ds.standbyName || '腾讯财经' }}</span></div>
        <div class="stat"><span class="k">最近请求耗时</span><span class="v">{{ ds.latencyMs === null ? '—' : ds.latencyMs + ' ms' }}</span></div>
        <div class="stat"><span class="k">累计切换次数</span><span class="v">{{ ds.failoverCount }}</span></div>
      </div>
      <p class="hint">主源异常时自动切换到备用源；恢复稳定 30 秒后切回。港股 / 美股走同一容灾通道，场外基金走净值通道。</p>
    </div>

    <div class="card">
      <h2>支持的市场</h2>
      <table class="mkts">
        <thead><tr><th>市场</th><th>示例</th><th>通道</th></tr></thead>
        <tbody>
          <tr><td>沪深 A 股</td><td class="mono">1.600519</td><td>东方财富 / 腾讯</td></tr>
          <tr><td>场内 ETF</td><td class="mono">1.510300</td><td>东方财富 / 腾讯</td></tr>
          <tr><td>港股</td><td class="mono">116.00700</td><td>东方财富 / 腾讯</td></tr>
          <tr><td>美股</td><td class="mono">105.AAPL</td><td>东方财富 / 腾讯</td></tr>
          <tr><td>场外基金</td><td class="mono">150.000001</td><td>东方财富基金（净值）</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../../api'
import { dsStateLabel, dsStateTone } from '@shared/index'
import type { DataSourceStatus } from '@shared/index'

const ds = ref<DataSourceStatus>({
  source: '', state: '', lastOkAt: null, latencyMs: null,
  primaryName: '', standbyName: '', failoverCount: 0,
})
let timer: ReturnType<typeof setInterval> | null = null

/** 状态文案/色调走共享映射：模板里必须用 computed，写成函数会被当成函数源码渲染出来 */
const stateLabel = computed(() => dsStateLabel(ds.value.state))
const stateTone = computed(() => dsStateTone(ds.value.state))

async function refresh(): Promise<void> {
  try { ds.value = await api.dataSourceStatus() } catch { /* 忽略 */ }
}
function timeago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  return `${Math.floor(s / 3600)} 小时前`
}
onMounted(async () => { await refresh(); timer = setInterval(refresh, 5000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.ds-view { width: 100%; max-width: 760px; }
.card { background: var(--surface); border: 1px solid var(--border-soft); border-radius: 12px; padding: 18px 22px; margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
h2 { font-size: 12px; color: var(--text-secondary); margin: 0 0 14px; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
.status-line { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.updated { margin-left: auto; font-size: 11px; color: var(--text-tertiary); white-space: nowrap; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--text-tertiary); flex: none; }
.status-dot.ok { background: #1db954; }
.status-dot.warn { background: #f5a623; }
.status-dot.bad { background: #e2493b; }
.source-name { font-size: 16px; font-weight: 600; color: var(--text); }
.state-badge { font-size: 11px; padding: 2px 9px; border-radius: 10px; background: var(--bg); color: var(--text-secondary); }
.state-badge.ok { background: rgba(29,185,84,.12); color: #1db954; }
.state-badge.warn { background: rgba(245,166,35,.14); color: #c98614; }
.state-badge.bad { background: rgba(226,73,59,.12); color: #e2493b; }
/* 4 个指标一行排满（面板内容宽约 730px），窗口变窄时自动折行 */
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.stat { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: var(--bg); border-radius: 8px; }
.stat .k { font-size: 11px; color: var(--text-tertiary); }
.stat .v { font-size: 14px; color: var(--text); font-weight: 600; }
.hint { font-size: 12px; color: var(--text-tertiary); line-height: 1.6; margin: 14px 0 0; }
.mkts { width: 100%; border-collapse: collapse; font-size: 12px; }
.mkts th, .mkts td { padding: 7px 10px; border-bottom: 1px solid var(--border-soft); text-align: left; color: var(--text); }
.mkts th { color: var(--text-secondary); font-weight: 600; }
.mkts tr:last-child td { border-bottom: none; }
.mono { font-family: 'SF Mono', Consolas, monospace; color: var(--text-secondary); }
</style>
