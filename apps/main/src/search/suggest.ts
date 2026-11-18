import type { SuggestItem } from '../../../../packages/shared/src/index.ts'

/** 常用宽基 ETF 兜底清单（文档 §6.4），网络搜索不可用时使用 */
export const BUILTIN_ETF: SuggestItem[] = [
  { secId: '1.510300', code: '510300', name: '沪深300ETF华泰柏瑞', market: 1, type: 'fund' },
  { secId: '1.510500', code: '510500', name: '中证500ETF南方', market: 1, type: 'fund' },
  { secId: '1.588000', code: '588000', name: '科创50ETF华夏', market: 1, type: 'fund' },
  { secId: '1.510880', code: '510880', name: '红利ETF华泰柏瑞', market: 1, type: 'fund' },
  { secId: '1.511990', code: '511990', name: '华宝添益货币ETF', market: 1, type: 'fund' },
  { secId: '1.518880', code: '518880', name: '黄金ETF华安', market: 1, type: 'fund' },
  { secId: '1.513100', code: '513100', name: '纳指ETF国泰', market: 1, type: 'fund' },
  { secId: '0.159915', code: '159915', name: '创业板ETF易方达', market: 0, type: 'fund' },
  { secId: '0.159919', code: '159919', name: '沪深300ETF嘉实', market: 0, type: 'fund' },
  { secId: '0.159949', code: '159949', name: '创业板50ETF', market: 0, type: 'fund' },
  { secId: '0.159612', code: '159612', name: '电力ETF', market: 0, type: 'fund' },
  { secId: '0.159766', code: '159766', name: '旅游ETF', market: 0, type: 'fund' },
  { secId: '1.600519', code: '600519', name: '贵州茅台', market: 1, type: 'stock' },
  { secId: '0.000001', code: '000001', name: '平安银行', market: 0, type: 'stock' },
  { secId: '1.601318', code: '601318', name: '中国平安', market: 1, type: 'stock' },
  { secId: '1.600036', code: '600036', name: '招商银行', market: 1, type: 'stock' },
  { secId: '0.300750', code: '300750', name: '宁德时代', market: 0, type: 'stock' },
]

let net_fetch: typeof fetch = globalThis.fetch
export function bindFetch(f: typeof fetch): void { net_fetch = f }

/**
 * A 股/场内基金代码：统一 6 位数字（沪深主板/创业板/科创板/北交所/ETF 均为 6 位）。
 * 东财 suggest 会混入期货(CN00Y)、港股(00700 等 5 位)等非 A 股品种，
 * 必须在搜索源头按「6 位数字 + 市场号 0/1」双重过滤。
 */
function isA股Code(code: string): boolean {
  return /^\d{6}$/.test(code)
}

/** 东财市场号：1=沪市，0=深市；其他值（港股/期货等）一律拒绝 */
function isA股Market(mktNum: unknown): boolean {
  return mktNum === '0' || mktNum === '1' || mktNum === 0 || mktNum === 1
}

/** 代码/名称搜索：东财 suggest 接口 + 内置清单兜底 */
export async function suggest(keyword: string): Promise<SuggestItem[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const hits = BUILTIN_ETF.filter((b) => b.code.includes(kw) || b.name.includes(kw)).slice(0, 8)
  try {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(kw)}&type=14&token=D43BF722C8E33BDC906FB84Ddda4e1ba&count=10`
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const res = await net_fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (res.ok) {
      const j = (await res.json()) as { QuotationCodeTable?: { Data?: { Code?: string; Name?: string; MktNum?: string; SecurityType?: string }[] } }
      const list = j?.QuotationCodeTable?.Data ?? []
      const out: SuggestItem[] = []
      for (const d of list) {
        if (!d.Code || !d.Name || d.MktNum === undefined) continue
        // 过滤期货(CN00Y)、港股(00700)等非 A 股品种：6 位数字 + 市场号 0/1
        if (!isA股Code(d.Code) || !isA股Market(d.MktNum)) continue
        const market = Number(d.MktNum) === 1 ? 1 : 0
        out.push({
          secId: `${market}.${d.Code}`,
          code: d.Code, name: d.Name, market,
          type: (d.SecurityType ?? '').includes('48') || d.Code.startsWith(('5')) || d.Code.startsWith(('1')) ? 'fund' : 'stock',
        })
      }
      if (out.length > 0) return out.slice(0, 10)
    }
  } catch { /* 兜底 */ }
  return hits
}
