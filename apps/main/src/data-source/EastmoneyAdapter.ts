import type { QuoteSnapshot, SecId } from '../../../../packages/shared/src/index.ts'
import { EM_HEADERS, num, mkSnapshot, type QuoteAdapter } from './types.ts'

/** 东财 push2 批量行情。字段映射见文档 §16.1 */
export class EastmoneyAdapter implements QuoteAdapter {
  readonly name = 'eastmoney'
  private endpoint = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
  private timeoutMs: number
  constructor(timeoutMs = 3000) { this.timeoutMs = timeoutMs }

  async fetchQuotes(secIds: SecId[]): Promise<QuoteSnapshot[]> {
    if (secIds.length === 0) return []
    const secids = secIds.map((s) => `${s.market}.${s.code}`).join(',')
    const url = `${this.endpoint}?fltt=2&secids=${encodeURIComponent(secids)}&fields=f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await net_fetch(url, { headers: EM_HEADERS, signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data?: { diff?: Record<string, unknown>[] } | null }
      const diff = json?.data?.diff
      if (!diff || !Array.isArray(diff)) return []
      return diff.map((d) => {
        const code = String(d.f12)
        const market = Number(d.f13) as 0 | 1
        return mkSnapshot({
          secId: `${market}.${code}`, code, market,
          name: String(d.f14 ?? ''),
          price: num(d.f2), changePct: num(d.f3), change: num(d.f4),
          volume: num(d.f5), amount: num(d.f6),
          high: num(d.f15), low: num(d.f16), open: num(d.f17), prevClose: num(d.f18),
        }, this.name)
      })
    } finally { clearTimeout(timer) }
  }

  async healthCheck(): Promise<boolean> {
    return this.fetchQuotes([{ market: 1, code: '000001' }]).then((r) => r.length > 0).catch(() => false)
  }
}

/** 渲染层不可用 net.fetch —— 主进程注入（便于测试替换） */
let net_fetch: typeof fetch = globalThis.fetch
export function bindFetch(f: typeof fetch): void { net_fetch = f }
