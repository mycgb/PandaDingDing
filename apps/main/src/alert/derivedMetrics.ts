/**
 * 派生指标：成交量倍数基准 + 连涨连跌天数。
 * 由主进程在喂给 AlertEngine 前，基于日K计算并注入 QuoteSnapshot 的可选字段，
 * 让引擎保持同步纯函数模型（无需在每轮判定里发网络请求）。
 */
import type { AlertMetric, AlertRule, QuoteSnapshot } from '../../../../packages/shared/src/index.ts'
import { phaseOf } from '../../../../packages/shared/src/index.ts'
import type { KlineService } from '../kline/KlineService.ts'

/** 需要日K派生数据的指标 */
const KLINE_METRICS: AlertMetric[] = ['volumeMultiple', 'streakUp', 'streakDown']

/**
 * 连涨/连跌天数。closes 为按时间正序的收盘价序列（最后一根可为当日）。
 * 返回 >0 = 连涨天数，<0 = 连跌天数（绝对值为天数），0 = 平盘/数据不足。
 */
export function computeStreak(closes: number[]): number {
  const c = closes.filter((v) => Number.isFinite(v) && v > 0)
  if (c.length < 2) return 0
  if (c[c.length - 1] === c[c.length - 2]) return 0
  const up = c[c.length - 1] > c[c.length - 2]
  let n = 0
  for (let i = c.length - 1; i > 0; i--) {
    if (up ? c[i] > c[i - 1] : c[i] < c[i - 1]) n++
    else break
  }
  return up ? n : -n
}

/**
 * 近 days 个「已收盘」交易日全天均量（排除最后一根=当日，盘中量未走完）。
 * 单位与日K volume 一致（手）。数据不足返回 null。
 */
export function computeVolumeBaseline(volumes: number[], days = 5): number | null {
  const closed = volumes.slice(0, -1).filter((v) => Number.isFinite(v) && v > 0).slice(-days)
  if (closed.length === 0) return null
  return closed.reduce((a, b) => a + b, 0) / closed.length
}

/**
 * 交易进度系数 0~1。盘中按已过交易分钟 / 全天 240 分钟折算，
 * 供成交量倍数把「当日累计量」折算成接近全天的可比倍数，避免盘中系统性偏低。
 * 收盘/周末/节假日 = 1；盘前给 0.1 下限防止刚开盘倍数虚高。
 */
export function tradingProgress(now: Date): number {
  const phase = phaseOf(now)
  if (phase === 'preOpen') return 0.1
  if (phase === 'continuous' || phase === 'lunch') {
    const m = now.getHours() * 60 + now.getMinutes()
    const morning = Math.max(0, Math.min(m - 570, 120))   // 09:30-11:30 → 570~690
    const afternoon = Math.max(0, Math.min(m - 780, 120))  // 13:00-15:00 → 780~900
    return Math.max(0.1, Math.min(1, (morning + afternoon) / 240))
  }
  return 1
}

/**
 * 若启用规则里用到派生指标，则对相关标的拉日K（KlineService 自带 10 分钟缓存），
 * 计算并就地注入 streakDays / volumeBaseline。无相关规则时直接返回，零额外开销。
 */
export async function enrichDerived(
  snapshots: QuoteSnapshot[],
  rules: AlertRule[],
  kline: KlineService,
  now: Date,
  log?: (...a: unknown[]) => void,
): Promise<void> {
  const active = rules.filter((r) => r.enabled && KLINE_METRICS.includes(r.metric))
  if (active.length === 0 || snapshots.length === 0) return

  const targets = new Set<string>()
  for (const r of active) {
    if (r.scope === 'global') snapshots.forEach((s) => targets.add(s.secId))
    else if (r.secId) targets.add(r.secId)
  }
  if (targets.size === 0) return

  const progress = tradingProgress(now)
  const wanted = snapshots.filter((s) => targets.has(s.secId))
  await Promise.all(wanted.map(async (s) => {
    try {
      const klines = await kline.fetch(s.secId, 101, 30)
      if (klines.length < 2) return
      s.streakDays = computeStreak(klines.map((k) => k.close))
      const base = computeVolumeBaseline(klines.map((k) => k.volume), 5)
      s.volumeBaseline = base === null ? null : base * progress
    } catch (e) {
      log?.('[Derived] 日K派生失败:', s.secId, e)
    }
  }))
}
