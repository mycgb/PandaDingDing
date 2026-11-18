import type { SuggestItem, MarketType, AssetCategory } from '../../../../packages/shared/src/index.ts'

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

/**
 * 剪贴板文本 → 股票代码识别（P2）：仅接受"整段就是代码"或"代码前有常见提示词"的场景，
 * 避免误判正常句子。返回 SuggestItem 供"加入自选"确认，网络仅用于补齐名称。
 * 支持的格式：600519 / sh600519 / 00700.HK / AAPL / hk00700 / usAAPL。
 */
export function parseClipboardCode(text: string): { code: string; market: MarketType } | null {
  const t = text.trim().replace(/[\u200b-\u200d\ufeff]/g, '')
  if (!t || t.length > 24) return null
  // 带显式市场前缀
  const prefixed = /^(sh|sz|hk|us)(\d{5,6}|[A-Za-z][A-Za-z0-9.]{0,9})$/i.exec(t)
  if (prefixed) {
    const p = prefixed[1].toLowerCase()
    const code = prefixed[2].toUpperCase()
    const market: MarketType = p === 'hk' ? 116 : p === 'us' ? 105 : p === 'sh' ? 1 : 0
    return { code, market }
  }
  // 港股后缀 .HK
  const hkSuffix = /^(\d{5})\.HK$/i.exec(t)
  if (hkSuffix) return { code: hkSuffix[1], market: 116 }
  // 纯 6 位数字按 A 股（沪深代码不冲突，默认沪市，用户可在结果里确认）
  if (/^\d{6}$/.test(t)) return { code: t, market: t.startsWith(('6')) ? 1 : 0 }
  // 纯美股字母代码（2-5 位）
  if (/^[A-Za-z][A-Za-z0-9]{1,5}$/.test(t)) return { code: t.toUpperCase(), market: 105 }
  return null
}

let net_fetch: typeof fetch = globalThis.fetch
export function bindFetch(f: typeof fetch): void { net_fetch = f }

/** 允许的市场号白名单：A股0/1、场外基金150、港股116、美股105/106/107。期货等其余一律拒绝。 */
const ALLOWED_MKT = new Set([0, 1, 116, 105, 106, 107, 150])
function toMarket(v: unknown): MarketType | null {
  const n = Number(v)
  return Number.isInteger(n) && ALLOWED_MKT.has(n) ? (n as MarketType) : null
}

/** 由市场号 + 东财 Classify/SecurityTypeName 推导资产类别 */
function toCategory(market: MarketType, d: { Classify?: string; SecurityTypeName?: string; Code?: string }): AssetCategory {
  if (market === 150) return 'fund'
  if (market === 116) return 'hk'
  if (market === 105 || market === 106 || market === 107) return 'us'
  // A 股：场内基金（ETF/LOF）按代码前缀识别，5/1 开头（沪）或 15/16 开头（深）
  const c = d.Code ?? ''
  const isFund = d.Classify === 'ETF'
    || d.SecurityTypeName?.includes('基金')
    || /^(5|1)/.test(c)
  return isFund ? 'etf' : 'stock'
}

/** 代码/名称搜索：东财 suggest 接口 + 内置清单兜底。覆盖 A股/场内基金/港股/美股/场外基金。 */
export async function suggest(keyword: string): Promise<SuggestItem[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const hits = BUILTIN_ETF.filter((b) => b.code.includes(kw) || b.name.includes(kw)).slice(0, 8)
  try {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(kw)}&type=14&token=D43BF722C8E33BDC906FB84Ddda4e1ba&count=12`
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const res = await net_fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (res.ok) {
      const j = (await res.json()) as { QuotationCodeTable?: { Data?: { Code?: string; Name?: string; MktNum?: string; Classify?: string; SecurityTypeName?: string }[] } }
      const list = j?.QuotationCodeTable?.Data ?? []
      const out: SuggestItem[] = []
      for (const d of list) {
        if (!d.Code || !d.Name || d.MktNum === undefined) continue
        const market = toMarket(d.MktNum)
        if (market === null) continue
        // 场外基金（MktNum=150）东财建议接口会返回多条同名不同代码，保留即可
        out.push({
          secId: `${market}.${d.Code}`,
          code: d.Code, name: d.Name, market,
          type: toCategory(market, d),
        })
      }
      if (out.length > 0) return out.slice(0, 10)
    }
  } catch { /* 兜底 */ }
  return hits
}
