<template>
  <section class="news-view">
    <div class="card">
      <div class="head">
        <div>
          <h2>今日新闻 · 财经快讯</h2>
          <p class="sub">东方财富全球快讯 · {{ items.length }} 条<span v-if="fetchedAt"> · 更新于 {{ updateTime }}</span></p>
        </div>
        <button class="refresh" :disabled="loading" @click="refresh(true)">
          {{ loading ? '加载中…' : '↻ 刷新' }}
        </button>
      </div>
      <div v-if="stale" class="notice">网络异常，显示的是上次缓存的内容</div>

      <div v-if="loading && !items.length" class="empty">正在加载新闻…</div>
      <div v-else-if="!items.length" class="empty">暂时没有新闻，点「刷新」重试</div>

      <ul v-else class="news-list">
        <li v-for="n in pagedItems" :key="n.id" class="news-item">
          <div class="row1">
            <span class="time">{{ shortTime(n.time) }}</span>
            <a class="title" :href="n.url" @click.prevent="open(n.url)">{{ n.title }}</a>
          </div>
          <p v-if="n.summary" class="summary">{{ n.summary }}</p>
          <div v-if="n.stocks.length" class="stocks">
            <span class="stocks-label">相关</span>
            <a v-for="sid in n.stocks" :key="sid" class="stock" :href="quoteUrl(sid)" @click.prevent="open(quoteUrl(sid))">
              {{ sid }}
            </a>
          </div>
        </li>
      </ul>

      <div v-if="totalPages > 1" class="pager">
        <button class="pg" :disabled="page <= 1" @click="turnPage(-1)">‹ 上一页</button>
        <span class="pg-info">第 {{ page }} / {{ totalPages }} 页</span>
        <button class="pg" :disabled="page >= totalPages" @click="turnPage(1)">下一页 ›</button>
      </div>

      <p class="hint">点击标题在浏览器中打开原文；点击「相关」代码查看该股行情。数据来自东方财富，仅供参考，不构成投资建议。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../../api'
import type { NewsItem } from '@shared/index'

const PAGE_SIZE = 10
const items = ref<NewsItem[]>([])
const loading = ref(false)
const stale = ref(false)
const fetchedAt = ref(0)
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(items.value.length / PAGE_SIZE)))
const pagedItems = computed(() => items.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
/** 翻页必须钳制边界：快速连点时 Vue 还没重渲染、按钮 disabled 仍是旧值，裸 page++ 会越过末页变成空页 */
function turnPage(delta: number): void {
  page.value = Math.min(totalPages.value, Math.max(1, page.value + delta))
}
const updateTime = computed(() => {
  if (!fetchedAt.value) return ''
  const d = new Date(fetchedAt.value)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
})

/** 2026-11-20 07:31:41 → 07:31（列表里日期见顶部，每行只留时分更紧凑） */
function shortTime(t: string): string {
  const m = /(\d{2}:\d{2})/.exec(t)
  return m ? m[1] : t
}

/** 把 secId（0.000672 / 116.00700）转成东方财富行情页地址 */
function quoteUrl(secId: string): string {
  const [market, code] = secId.split('.')
  const prefix = market === '0' ? 'sz' : market === '1' ? 'sh' : market === '116' ? 'hk' : 'us'
  return `https://quote.eastmoney.com/${prefix}${code}.html`
}

function open(url: string): void {
  api.openExternal(url).catch(() => { /* 打开失败静默 */ })
}

async function refresh(force = false): Promise<void> {
  loading.value = true
  try {
    const r = await api.newsFetch(force)
    items.value = r.items
    stale.value = r.stale
    fetchedAt.value = r.fetchedAt
    page.value = 1 // 拉新数据后回到第一页，避免停在越界页
  } catch {
    stale.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => { void refresh(false) })
</script>

<style scoped>
.news-view { width: 100%; max-width: 760px; }
.card { background: var(--surface); border: 1px solid var(--border-soft); border-radius: 12px; padding: 18px 22px; margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
h2 { font-size: 12px; color: var(--text-secondary); margin: 0 0 6px; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
.sub { font-size: 11px; color: var(--text-tertiary); margin: 0; }
.refresh { flex: none; padding: 6px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 12px; cursor: pointer; }
.refresh:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.refresh:disabled { opacity: .55; cursor: default; }
.notice { margin-top: 12px; padding: 8px 10px; border-radius: 8px; background: rgba(245,166,35,.12); color: #c98614; font-size: 12px; }
.empty { padding: 40px 0; text-align: center; color: var(--text-tertiary); font-size: 13px; }
.news-list { list-style: none; margin: 14px 0 0; padding: 0; }
.news-item { padding: 12px 0; border-bottom: 1px solid var(--border-soft); }
.news-item:last-child { border-bottom: none; }
.row1 { display: flex; align-items: baseline; gap: 10px; }
.time { flex: none; font: 11px 'SF Mono', Consolas, monospace; color: var(--text-tertiary); }
.title { font-size: 13px; color: var(--text); font-weight: 600; line-height: 1.5; cursor: pointer; text-decoration: none; }
.title:hover { color: var(--accent); }
.summary { margin: 6px 0 0 52px; font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.stocks { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0 0 52px; }
.stocks-label { font-size: 11px; color: var(--text-tertiary); }
.stock { font: 11px 'SF Mono', Consolas, monospace; color: var(--accent); text-decoration: none; padding: 2px 7px; border-radius: 6px; background: var(--bg); border: 1px solid var(--border-soft); cursor: pointer; }
.stock:hover { border-color: var(--accent); }
.pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border-soft); }
.pg { padding: 5px 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); font-size: 12px; cursor: pointer; }
.pg:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.pg:disabled { opacity: .4; cursor: default; }
.pg-info { font-size: 12px; color: var(--text-secondary); }
.hint { font-size: 12px; color: var(--text-tertiary); line-height: 1.6; margin: 14px 0 0; }
</style>
