/**
 * 盘中异动雷达：涨速计算 + 涨跌停判定（纯逻辑，不依赖 electron，便于单测）。
 *
 * 涨速用本地环形缓冲算，不额外请求接口：
 *   每股每轮轮询（盘中 3s）记一个价格点，只保留最近 N 分钟。
 * 涨跌停按 A 股板块规则推算限价，用于「触及涨跌停」提醒。
 */
import type { MarketType } from '../../../../packages/shared/src/index.ts'

/** 保留多久的价格历史（要覆盖涨速窗口 + 一点余量） */
const KEEP_MS = 12 * 60_000
/** 涨速默认时间窗 */
export const SPEED_WINDOW_MS = 3 * 60_000
/** 窗口内至少要有这么长的跨度才算有效，避免刚启动时用两个相邻点算涨速 */
const MIN_SPAN_MS = 45_000

export interface PricePoint { t: number; p: number }

/** 涨跌停幅度：ST 5%、创业板/科创板 20%、北交所 30%，其余 10%。
 *  只对 A 股与场内基金（market 0/1）生效，港美股/场外基金返回 0（不判定）。 */
export function limitRatioOf(code: string, name: string, market: MarketType): number {
  if (market !== 0 && market !== 1) return 0
  if (/ST/i.test(name)) return 0.05
  if (/^(300|301|688|689)/.test(code)) return 0.20
  if (/^(8|4|92)/.test(code)) return 0.30
  return 0.10
}

function round2(v: number): number { return Math.round(v * 100) / 100 }

/** 按昨收推算涨停/跌停价（四舍五入到分，与交易所一致） */
export function limitPrices(prevClose: number, ratio: number): { up: number; down: number } {
  return { up: round2(prevClose * (1 + ratio)), down: round2(prevClose * (1 - ratio)) }
}

/** 当前是否触及涨停/跌停（容差 0.005 元，避免浮点误差漏判） */
export function limitStateOf(input: {
  price: number | null
  prevClose: number | null
  code: string
  name: string
  market: MarketType
}): 'up' | 'down' | null {
  const { price, prevClose } = input
  const ratio = limitRatioOf(input.code, input.name, input.market)
  if (!ratio || price == null || !prevClose || prevClose <= 0 || price <= 0) return null
  const { up, down } = limitPrices(prevClose, ratio)
  if (price >= up - 0.005) return 'up'
  if (price <= down + 0.005) return 'down'
  return null
}

/**
 * 价格环形缓冲：按 secId 保存最近 12 分钟的点，算任意窗口的涨跌幅。
 * 只在有价格时记录；同一毫秒重复写入会被去重（避免重复点干扰）。
 */
export class SpeedTracker {
  private buf = new Map<string, PricePoint[]>()

  /** 记录本轮价格（原地更新，无返回值） */
  ingest(list: { secId: string; price: number | null }[], now: number): void {
    for (const s of list) {
      const p = s.price
      if (p == null || !Number.isFinite(p) || p <= 0) continue
      const arr = this.buf.get(s.secId) ?? []
      const last = arr[arr.length - 1]
      if (last && now - last.t < 1000) continue   // 1 秒内重复，跳过
      arr.push({ t: now, p })
      this.buf.set(s.secId, arr)
    }
    this.prune(now)
  }

  /** 近 windowMs 的涨跌 %；数据跨度不足或价格异常返回 null */
  speedOf(secId: string, now: number, windowMs = SPEED_WINDOW_MS): number | null {
    const arr = this.buf.get(secId)
    if (!arr || arr.length < 2) return null
    const latest = arr[arr.length - 1]
    const from = now - windowMs
    // 取窗口内最早的点
    let base: PricePoint | null = null
    for (const pt of arr) {
      if (pt.t >= from) { base = pt; break }
    }
    if (!base) base = arr[0]
    // 跨度不足（刚启动/刚添加自选）不算涨速，否则会拿两个相邻点算出假信号
    if (latest.t - base.t < MIN_SPAN_MS) return null
    if (base.p <= 0) return null
    return ((latest.p - base.p) / base.p) * 100
  }

  /** 丢弃过期点；某只股票没有近期数据时整体移除，避免 Map 无限增长 */
  prune(now: number): void {
    const cutoff = now - KEEP_MS
    for (const [id, arr] of this.buf) {
      let i = 0
      while (i < arr.length && arr[i].t < cutoff) i++
      if (i > 0) arr.splice(0, i)
      if (arr.length === 0) this.buf.delete(id)
    }
  }

  /** 当前缓存的标的数（诊断用） */
  size(): number { return this.buf.size }
}
