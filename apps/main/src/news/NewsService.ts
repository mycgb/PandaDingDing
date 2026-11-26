import type { NewsItem, NewsResult } from '../../../packages/shared/src/index.ts'

/**
 * 今日新闻：东方财富「全球快讯」接口，免费、无需 key、实时（秒级）。
 *
 * 接口参数曾逐个报缺失（snake_case → 驼峰 → req_trace），这里一次性给全；
 * sortEnd=0 表示取最新，翻页时用上一页返回的 data.sortEnd（本项目只取第一页）。
 * 详情页 https://finance.eastmoney.com/a/<code>.html 已验证正文对应。
 *
 * 新闻里的「相关」标的来自 stockList（secId 形如 0.000672）。该列表里混有
 * 已退市/代码变更的脏数据（实测 0.928803 在行情系统查不到）。因此抓到快讯后
 * 再走 push2 ulist.np 批量查一次名称：查得到的显示名称、查不到的当无效代码剔除。
 */
const API = 'https://np-listapi.eastmoney.com/comm/web/getFastNewsList'
const NAME_API = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
const DETAIL_BASE = 'https://finance.eastmoney.com/a/'
const CACHE_TTL_MS = 5 * 60_000
/** 手动刷新也留个最小间隔，避免连点把接口打爆 */
const FORCE_MIN_GAP_MS = 5_000
/** 名称接口分批大小，控制 URL 长度 */
const NAME_BATCH = 50

/** secId = 市场号.代码。板块(90)不在新闻 stockList 的取值范围内，沿用原白名单 */
const SEC_ID_RE = /^(0|1|105|106|107|116|150)\.[A-Za-z0-9.]{1,10}$/

/** 单条原始快讯 → NewsItem；无 code 或标题视为无效。stocks 的 name 先以 secId 占位 */
export function parseNewsRow(raw: Record<string, unknown>): NewsItem | null {
  const code = typeof raw.code === 'string' ? raw.code.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!code || !title) return null
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  const time = typeof raw.showTime === 'string' ? raw.showTime.trim() : ''
  const stocks = Array.isArray(raw.stockList)
    ? raw.stockList
        .filter((s): s is string => typeof s === 'string' && SEC_ID_RE.test(s))
        .map((id) => ({ id, name: id }))
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

/** push2 ulist.np 的 diff → { secId: 名称 }。查不到的 secId 不会出现在 diff 里。 */
export function parseStockNames(json: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!json || typeof json !== 'object') return out
  const data = (json as { data?: unknown }).data
  if (!data || typeof data !== 'object') return out
  const diff = (data as { diff?: unknown }).diff
  if (!Array.isArray(diff)) return out
  for (const row of diff) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const market = r.f13
    const code = r.f12
    const name = r.f14
    if (typeof market !== 'number' || typeof code !== 'string' || typeof name !== 'string' || !name) continue
    out[`${market}.${code}`] = name.trim()
  }
  return out
}

/**
 * 把查到的名称写回关联标的。
 * names=null 表示查名请求整体失败：保留全部标的、name 维持 secId 占位（宁可显示代码也不误删有效数据）；
 * names 是对象时：查不到名称的标的视为无效代码剔除。
 */
export function applyStockNames(items: NewsItem[], names: Record<string, string> | null): NewsItem[] {
  if (!names) return items
  return items.map((item) => ({
    ...item,
    stocks: item.stocks
      .filter((s) => Boolean(names[s.id]))
      .map((s) => ({ id: s.id, name: names[s.id] || s.id })),
  }))
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

  /** 分批查 secId 对应的展示名称，返回 { secId: name } */
  private async fetchStockNames(secIds: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (let i = 0; i < secIds.length; i += NAME_BATCH) {
      const batch = secIds.slice(i, i + NAME_BATCH)
      const qs = new URLSearchParams({ secids: batch.join(','), fields: 'f12,f13,f14' })
      const res = await this.fetch(`${NAME_API}?${qs.toString()}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' },
      })
      if (!res.ok) throw new Error(`名称查询 HTTP ${res.status}`)
      Object.assign(out, parseStockNames(await res.json()))
    }
    // 全部批次都成功却一个名字都没查到，多半是接口结构变了，回退到显示代码
    if (secIds.length && !Object.keys(out).length) throw new Error('名称查询返回空')
    return out
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
    const rows = parseNewsResponse(json)
    if (!rows.length) throw new Error('空新闻列表')

    // 汇总所有关联 secId 去重后一次（或分批）查名
    const secIds = [...new Set(rows.flatMap((n) => n.stocks.map((s) => s.id)))]
    let names: Record<string, string> | null = null
    if (secIds.length) {
      try {
        names = await this.fetchStockNames(secIds)
      } catch (e) {
        this.log?.('关联标的名称查询失败，回退显示代码:', e instanceof Error ? e.message : String(e))
      }
    }
    return { items: applyStockNames(rows, names), fetchedAt: Date.now(), stale: false }
  }
}
