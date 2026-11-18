import type { QuoteSnapshot, SecId } from '../../../../packages/shared/src/index.ts'
import { TX_HEADERS, num, mkSnapshot, type QuoteAdapter } from './types.ts'

/** 腾讯 qt.gtimg.cn 备用源。GBK 编码、~ 分隔。字段下标映射见文档 §16.2 */
export class TencentAdapter implements QuoteAdapter {
  readonly name = 'tencent'
  private endpoint = 'https://qt.gtimg.cn/q='
  private timeoutMs: number
  constructor(timeoutMs = 3000) { this.timeoutMs = timeoutMs }

  async fetchQuotes(secIds: SecId[]): Promise<QuoteSnapshot[]> {
    if (secIds.length === 0) return []
    const q = secIds.map((s) => `${s.market === 1 ? 'sh' : 'sz'}${s.code}`).join(',')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await net_fetch(this.endpoint + q, { headers: TX_HEADERS, signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = new Uint8Array(await res.arrayBuffer())
      const text = new TextDecoder('gbk').decode(buf)
      return this.parse(text)
    } finally { clearTimeout(timer) }
  }

  /** v_sh600519="1~贵州茅台~600519~1443.12~..." 行集合解析。
   *  买卖五档字段数量随市场/品种浮动，改用「14 位时间戳」作动态锚点：
   *  ...~ts~涨跌~涨跌幅~最高~最低~成交明细~成交量(手)~成交额(万)~... */
  parse(text: string): QuoteSnapshot[] {
    const out: QuoteSnapshot[] = []
    for (const line of text.split('\n')) {
      const m = /v_(sh|sz)(\d+)="(.*)"\s*;?\s*$/.exec(line.trim())
      if (!m) continue
      const market = m[1] === 'sh' ? 1 : 0
      const code = m[2]
      const f = m[3].split('~')
      const g = (i: number) => num(f[i])
      const tsIdx = f.findIndex((x) => /^\d{14}$/.test(x ?? ''))
      if (tsIdx < 12) continue   // 找不到合法时间戳锚点（或位置异常），跳过该行
      out.push(mkSnapshot({
        secId: `${market}.${code}`, code, market,
        name: f[1] ?? '',
        price: g(3), prevClose: g(4), open: g(5),
        change: g(tsIdx + 1), changePct: g(tsIdx + 2),
        high: g(tsIdx + 3), low: g(tsIdx + 4),
        volume: g(tsIdx + 6),
        amount: g(tsIdx + 7) !== null ? (g(tsIdx + 7) as number) * 10_000 : null,
      }, this.name))
    }
    return out
  }

  async healthCheck(): Promise<boolean> {
    return this.fetchQuotes([{ market: 1, code: '600519' }]).then((r) => r.length > 0).catch(() => false)
  }
}

let net_fetch: typeof fetch = globalThis.fetch
export function bindFetch(f: typeof fetch): void { net_fetch = f }
