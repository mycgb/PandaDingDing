import { EventEmitter } from 'node:events'
import type { KlinePoint, TrendsResult } from '../../../../packages/shared/src/index.ts'

/** 时段 -> 缓存 TTL（盘中分时短缓存，日/周/月长缓存） */
function ttlOf(klt: number): number {
  if (klt < 60) return 60_000        // 分钟线 1 分钟
  if (klt === 60) return 120_000     // 60 分钟线 2 分钟
  return 10 * 60_000                 // 日/周/月线 10 分钟
}

/** 东财 K 线服务：主进程 net.fetch + 内存缓存 */
export class KlineService extends EventEmitter {
  private cache = new Map<string, { at: number; data: KlinePoint[] | TrendsResult }>()

  constructor(private timeoutMs = 3000) { super() }

  async fetch(secId: string, klt: number, lmt = 120): Promise<KlinePoint[]> {
    const key = `${secId}|${klt}|${lmt}`
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < ttlOf(klt)) return hit.data

    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get`
      + `?secid=${encodeURIComponent(secId)}&klt=${klt}&fqt=1`
      + `&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58`
      + `&lmt=${lmt}&end=20500101`

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    let body: string
    try {
      const res = await netFetch(url, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      body = await res.text()
    } finally { clearTimeout(timer) }

    const json = JSON.parse(body) as { data?: { klines?: string[] } | null }
    const lines = json?.data?.klines ?? []
    const data = lines.map(parseLine).filter((p): p is KlinePoint => p !== null)
    this.cache.set(key, { at: Date.now(), data })
    return data
  }

  /** 当日分时走势（trends2）：逐分钟价格/均价/成交量 */
  async fetchTrends(secId: string): Promise<TrendsResult> {
    const key = `trends|${secId}`
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < 60_000) return hit.data as TrendsResult

    const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get`
      + `?secid=${encodeURIComponent(secId)}&fields1=f1,f2,f3,f4,f5,f6,f7,f8`
      + `&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0&forcect=1`

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    let body: string
    try {
      const res = await netFetch(url, { signal: ctrl.signal, headers: { Referer: 'https://quote.eastmoney.com/' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      body = await res.text()
    } finally { clearTimeout(timer) }

    const json = JSON.parse(body) as { data?: { preClose?: number; trends?: string[] } | null }
    const preClose = json?.data?.preClose ?? 0
    const trends = (json?.data?.trends ?? []).map((line) => {
      const f = line.split(',')
      const n = (v: string) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
      return { time: f[0], price: n(f[2]), avg: n(f[7]), volume: n(f[5]) }
    }).filter((p) => p.price > 0)
    const result: TrendsResult = { preClose, trends }
    this.cache.set(key, { at: Date.now(), data: result })
    return result
  }

  clearCache(): void { this.cache.clear() }
}

function parseLine(line: string): KlinePoint | null {
  const f = line.split(',')
  if (f.length < 8) return null
  const n = (v: string) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
  return {
    time: f[0], open: n(f[1]), close: n(f[2]), high: n(f[3]), low: n(f[4]),
    volume: n(f[5]), amount: n(f[6]), amplitude: n(f[7]),
  }
}

let netFetch: typeof fetch = globalThis.fetch
export function bindFetch(f: typeof fetch): void { netFetch = f }
