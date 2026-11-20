import type { NewsItem, NewsResult } from '../../../packages/shared/src/index.ts'

/**
 * 今日新闻：东方财富「全球快讯」接口，免费、无需 key、实时（秒级）。
 *
 * 接口参数曾逐个报缺失（snake_case → 驼峰 → req_trace），这里一次性给全；
 * sortEnd=0 表示取最新，翻页时用上一页返回的 data.sortEnd（本项目只取第一页）。
 * 详情页 https://finance.eastmoney.com/a/<code>.html 已验证正文对应。
 */
const API = 'https://np-listapi.eastmoney.com/comm/web/getFastNewsList'
const DETAIL_BASE = 'https://finance.eastmoney.com/a/'
const CACHE_TTL_MS = 5 * 60_000
/** 手动刷新也留个最小间隔，避免连点把接口打爆 */
const FORCE_MIN_GAP_MS = 5_000

/** 单条原始快讯 → NewsItem；无 code 或标题视为无效 */
export function parseNewsRow(raw: Record<string, unknown>): NewsItem | null {
  const code = typeof raw.code === 'string' ? raw.code.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!code || !title) return null
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  const time = typeof raw.showTime === 'string' ? raw.showTime.trim() : ''
  const stocks = Array.isArray(raw.stockList)
    ? raw.stockList.filter((s): s is string =>
        typeof s === 'string' && /^(0|1|105|106|107|116|150)\.[A-Za-z0-9.]{1,10}$/.test(s))
    : []
  return { id: code, title, summary, time, stocks, url: `${DETAIL_BASE}${code}.html` }
}

/** 解析接口响应；字段缺失/类型异常时跳过该条，不抛错。按 code 去重。 */
export function parseNewsResponse(json: unknown): NewsItem[] {
  if (!json || typeof json !== 'object') return []
  const data = (json as { data?: unknown }).data
  if (!data || typeof data !== 'object') return []
  const list = (data as { fastNewsList?: unknown }).fastNewsList
  if (!Array.isArray(list)) return []
  const out: NewsItem[] = []
  const seen = new Set<string>()
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const item = parseNewsRow(row as Record<string, unknown>)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function traceId(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36)
}

export class NewsService {
  private cache: NewsResult = { items: [], fetchedAt: 0, stale: false }
  private inflight: Promise<NewsResult> | null = null
  private lastForce = 0
  private readonly fetch: typeof fetch
  private readonly log?: (...a: unknown[]) => void

  constructor(fetch: typeof fetch, log?: (...a: unknown[]) => void) {
    this.fetch = fetch
    this.log = log
  }

  /**
   * 拉取新闻。force=true 时跳过 TTL 强制刷新（仍受最小间隔保护）；
   * 并发调用共享同一个请求；失败时返回上次缓存并标记 stale，绝不因网络抖动让页面空白。
   */
  getNews(force = false): Promise<NewsResult> {
    const now = Date.now()
    if (!force && this.cache.items.length && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return Promise.resolve(this.cache)
    }
    if (force && this.cache.items.length && now - this.lastForce < FORCE_MIN_GAP_MS) {
      return Promise.resolve(this.cache)
    }
    if (this.inflight) return this.inflight
    this.lastForce = now
    this.inflight = this.doFetch()
      .then((r) => { this.cache = r; return r })
      .catch((e) => {
        this.log?.('新闻抓取失败:', e instanceof Error ? e.message : String(e))
        if (this.cache.items.length) return { ...this.cache, stale: true }
        return { items: [], fetchedAt: 0, stale: true }
      })
      .finally(() => { this.inflight = null })
    return this.inflight
  }

  private async doFetch(): Promise<NewsResult> {
    const qs = new URLSearchParams({
      client: 'web', biz: 'web_news_col', fastColumn: '102', sortEnd: '0',
      // 多拉一些供前端分页浏览（每页 10 条），翻页纯本地、不走网络
      order: '1', needJumpAd: 'true', pageSize: '50', pageIndex: '1', req_trace: traceId(),
    })
    const res = await this.fetch(`${API}?${qs.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://kuaixun.eastmoney.com/' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const items = parseNewsResponse(json)
    if (!items.length) throw new Error('空新闻列表')
    return { items, fetchedAt: Date.now(), stale: false }
  }
}
