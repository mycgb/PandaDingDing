import type { QuoteSnapshot, SecId, MarketType } from '../../../../packages/shared/src/index.ts'
import { TX_HEADERS, num, mkSnapshot, type QuoteAdapter } from './types.ts'

/** 腾讯 qt.gtimg.cn 备用源。GBK 编码、~ 分隔。字段下标映射见文档 §16.2。
 *  港美股同样支持：hk00700 / usAAPL。 */
export class TencentAdapter implements QuoteAdapter {
  readonly name = 'tencent'
  private endpoint = 'https://qt.gtimg.cn/q='
  private timeoutMs: number
  constructor(timeoutMs = 3000) { this.timeoutMs = timeoutMs }

  /** market 号 → 腾讯代码前缀。港美股走 hk/us，A 股走 sh/sz。 */
  private txCode(s: SecId): string {
    if (s.market === 116) return `hk${s.code}`
    if (s.market === 105 || s.market === 106 || s.market === 107) return `us${s.code}`
    return `${s.market === 1 ? 'sh' : 'sz'}${s.code}`
  }

  async fetchQuotes(secIds: SecId[]): Promise<QuoteSnapshot[]> {
    if (secIds.length === 0) return []
    const q = secIds.map((s) => this.txCode(s)).join(',')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await net_fetch(this.endpoint + q, { headers: TX_HEADERS, signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = new Uint8Array(await res.arrayBuffer())
      const text = new TextDecoder('gbk').decode(buf)
      // 用 code → 原始 secId 反查，修正美股市场号（腾讯返回不区分 105/106/107）
      const codeMap = new Map(secIds.map((s) => [s.code.toLowerCase(), s]))
      return this.parse(text, codeMap)
    } finally { clearTimeout(timer) }
  }

  /** v_sh600519 / v_hk00700 / v_usAAPL="1~名称~代码~现价~..." 行集合解析。
   *  A 股用「14 位时间戳」作动态锚点；港美股时间戳为 yyyy/mm/dd HH:mm:ss 或 yyyy-mm-dd HH:mm:ss，
   *  统一识别两类时间格式定位锚点。 */
  parse(text: string, codeMap?: Map<string, SecId>): QuoteSnapshot[] {
    const out: QuoteSnapshot[] = []
    for (const line of text.split('\n')) {
      const m = /v_(sh|sz|hk|us)([A-Za-z0-9]+)="(.*)"\s*;?\s*$/.exec(line.trim())
      if (!m) continue
      const prefix = m[1]
      const code = m[2]
      const f = m[3].split('~')
      const g = (i: number) => num(f[i])
      // 时间戳锚点：14 位纯数字（A股）或带分隔符的日期时间（港美股）
      const tsIdx = f.findIndex((x) => /^\d{14}$/.test(x ?? '') || /^\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}/.test(x ?? ''))
      if (tsIdx < 12) continue   // 找不到合法时间戳锚点（或位置异常），跳过该行
      // 市场号：优先用请求时的原始 market（美股能区分 105/106/107），否则按前缀推断
      const orig = codeMap?.get(code.toLowerCase())
      const market: MarketType = orig?.market
        ?? (prefix === 'sh' ? 1 : prefix === 'sz' ? 0 : prefix === 'hk' ? 116 : 105)
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
