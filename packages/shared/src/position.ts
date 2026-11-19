/**
 * 持仓盈亏计算（纯函数，无 IO，便于单测）。
 *
 * 约定：
 * - shares <= 0 或没有有效现价 → 返回 null（视为未持仓，不参与汇总）
 * - costPrice <= 0 视为“只记股数不记成本”，此时累计盈亏记 0，避免把成本当成 0 元
 * - 当日盈亏用昨收计算，与行情软件口径一致（不含手续费）
 */

export interface PositionInput {
  shares: number
  costPrice: number
  price: number | null
  prevClose: number | null
}

export interface PositionStats {
  /** 市值 = 股数 × 现价 */
  marketValue: number
  /** 持仓成本 = 股数 × 成本价（无成本价时按现价计） */
  costValue: number
  /** 当日盈亏 = 股数 ×（现价 − 昨收） */
  dayPnl: number
  /** 累计盈亏 = 股数 ×（现价 − 成本价） */
  totalPnl: number
  /** 当日盈亏率 % */
  dayPct: number | null
  /** 累计盈亏率 % */
  totalPct: number | null
}

export function calcPosition(input: PositionInput): PositionStats | null {
  const shares = Number(input.shares)
  if (!Number.isFinite(shares) || shares <= 0) return null
  const price = input.price
  if (price === null || !Number.isFinite(price) || price <= 0) return null
  const cost = Number.isFinite(input.costPrice) ? input.costPrice : 0
  const prevClose = input.prevClose && input.prevClose > 0 ? input.prevClose : null

  const marketValue = shares * price
  const costValue = shares * (cost > 0 ? cost : price)
  const dayPnl = prevClose ? shares * (price - prevClose) : 0
  const totalPnl = cost > 0 ? shares * (price - cost) : 0

  return {
    marketValue,
    costValue,
    dayPnl,
    totalPnl,
    dayPct: prevClose ? ((price - prevClose) / prevClose) * 100 : null,
    totalPct: cost > 0 ? ((price - cost) / cost) * 100 : null,
  }
}

export interface PortfolioPosition {
  marketValue: number
  costValue: number
  dayPnl: number
  totalPnl: number
  /** 有持仓的标的数 */
  count: number
}

export function sumPositions(list: PositionStats[]): PortfolioPosition {
  const acc: PortfolioPosition = { marketValue: 0, costValue: 0, dayPnl: 0, totalPnl: 0, count: 0 }
  for (const p of list) {
    acc.marketValue += p.marketValue
    acc.costValue += p.costValue
    acc.dayPnl += p.dayPnl
    acc.totalPnl += p.totalPnl
    acc.count += 1
  }
  return acc
}

/** 仓位占比 %（该标的市值 / 组合总市值），无持仓或无总市值时为 null */
export function positionWeight(marketValue: number, totalMarketValue: number): number | null {
  if (!Number.isFinite(marketValue) || !Number.isFinite(totalMarketValue) || totalMarketValue <= 0) return null
  return (marketValue / totalMarketValue) * 100
}
