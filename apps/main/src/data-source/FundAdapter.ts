import type { QuoteSnapshot, SecId } from '../../../../packages/shared/src/index.ts'
import { num, mkSnapshot, type QuoteAdapter } from './types.ts'

/**
 * 场外基金适配器（净值型，market=150）。
 * 东财 push2 不支持场外基金，改用 fund.eastmoney.com 的 pingzhongdata 脚本：
 *   var fS_name = "华夏成长混合";
 *   var Data_netWorthTrend = [{"x":时间戳,"y":累计净值,"equityReturn":日涨跌%,...}, ...]
 * 场外基金当天 15:00 后才出净值，盘中最后一次净值即"最新价"，涨跌幅取当日 equityReturn。
 */
export class FundAdapter implements QuoteAdapter {
  readonly name = 'eastmoney-fund'
  private endpoint = 'https://fund.eastmoney.com/pingzhongdata/'
  private timeoutMs: number
  constructor(timeoutMs = 4000) { this.timeoutMs = timeoutMs }

  async fetchQuotes(secIds: SecId[]): Promise<QuoteSnapshot[]> {
    const out: QuoteSnapshot[] = []
    for (const s of secIds) {
      const one = await this.fetchOne(s)
      if (one) out.push(one)
    }
    return out
  }

  private async fetchOne(s: SecId): Promise<QuoteSnapshot | null> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    let text: string
    try {
      const res = await net_fetch(`${this.endpoint}${s.code}.js`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          Referer: 'https://fund.eastmoney.com/',
        },
        signal: ctrl.signal,
      })
      if (!res.ok) return null
      text = await res.text()
    } catch { return null } finally { clearTimeout(timer) }
    return this.parse(text, s)
  }

  /** 解析 pingzhongdata 脚本（纯函数，便于测试） */
  parse(text: string, s: SecId): QuoteSnapshot | null {
    const nameM = /fS_name\s*=\s*"([^"]*)"/.exec(text)
    const trendM = /Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])/.exec(text)
    if (!nameM || !trendM) return null
    let arr: { x: number; y: number; equityReturn?: number | string }[] = []
    try { arr = JSON.parse(trendM[1]) as typeof arr } catch { return null }
    if (!Array.isArray(arr) || arr.length === 0) return null
    const last = arr[arr.length - 1]
    const prev = arr.length >= 2 ? arr[arr.length - 2] : null
    const price = num(last.y)
    const pct = num(last.equityReturn)
      ?? (prev && num(prev.y) ? Number((((last.y - prev.y) / prev.y) * 100).toFixed(2)) : null)
    return mkSnapshot({
      secId: `${s.market}.${s.code}`, code: s.code, name: nameM[1], market: s.market,
      price, changePct: pct,
      // 场外基金无盘中量价：相关字段置空
      change: null, volume: null, amount: null,
      high: null, low: null, open: null,
      prevClose: prev ? num(prev.y) : null,
    }, this.name)
  }

  async healthCheck(): Promise<boolean> {
    return this.fetchOne({ market: 150, code: '000001' }).then((r) => !!r?.price).catch(() => false)
  }
}

let net_fetch: typeof fetch = globalThis.fetch
export function bindFetch(f: typeof fetch): void { net_fetch = f }
