import type { QuoteSnapshot, WatchItem, PetState } from '../../../../packages/shared/src/index.ts'
import type { MarketPhase } from '../../../../packages/shared/src/index.ts'

/** 组合情绪指标（文档 §11.2）：加权涨跌幅 → 桌宠情绪 */
export function portfolioPct(snaps: QuoteSnapshot[], watchlist: WatchItem[]): number | null {
  const weightBy = new Map(watchlist.map((w) => [w.secId, w.weight]))
  let sum = 0, wsum = 0
  for (const s of snaps) {
    if (s.changePct === null || s.changePct === undefined) continue   // 停牌剔除
    const w = weightBy.get(s.secId) ?? 1
    sum += s.changePct * w
    wsum += w
  }
  return wsum === 0 ? null : sum / wsum
}

export interface MoodThresholds { up: number; down: number }

/** 组合情绪 → 基础桌宠状态（不含提醒/离线打断） */
export function baseMoodState(pct: number | null, th: MoodThresholds): PetState {
  if (pct === null) return { action: 'idle', reason: 'no-data' }
  if (pct >= th.up) return { action: 'idle-smile' }
  if (pct <= th.down) return { action: 'idle-frown' }
  return { action: 'idle' }
}

/**
 * 休市日 → 桌宠附加状态。
 * 周末 / 节假日整天躺下休息（这两天没有行情，醒来也无事可做）。
 * 注意：交易日里的「午休 / 收盘后 / 开盘前」**不再由代码写死**，一律交给设置页的
 * 免打扰（休息）时段判定 —— 用户想删就删，删光后桌宠就一直按情绪活动。
 * 盘后也不再静止"睡觉"，sleepy 是降速播放的呼吸动作，保证桌宠持续有生命感；
 * 仅"离线"一种情况静止（offline 动作），因为此时没有任何数据可展示。
 */
export function restDayOverride(phase: MarketPhase): PetState | null {
  if (phase === 'weekend' || phase === 'holiday') return { action: 'sleepy', reason: phase }
  return null
}

/**
 * 漫游是否接管当前基础情绪。
 * 只在中性 idle（组合无涨跌倾向）且控制器判定可漫游时接管为 walk；
 * 不覆盖 idle-smile / idle-frown（有明确情绪时保持站立表达）。
 * 这是纯函数，便于单测。
 */
export function roamDecision(base: PetState, roamActive: boolean, facing?: 'left' | 'right'): PetState {
  if (!roamActive || base.action !== 'idle') return base
  return { action: 'walk', reason: 'roam', facing: facing ?? 'right' }
}

/**
 * 状态优先级：alert > offline > 免打扰(dnd) > 休市日(sleepy) > mood(+walk)
 * 注意：桌宠永远有一个"在播放"的动作，不存在完全静止的时段（sleepy 只是躺下呼吸）。
 * walk 由 RoamController 调度，只在中性 idle 且控制器放行时接管。
 */
export function resolvePetState(input: {
  alertActive?: boolean
  alertDirection?: 'up' | 'down'
  /** 提醒类型：定时时点提醒用 'time'（慢摇催办），规则提醒按涨跌 */
  alertKind?: 'up' | 'down' | 'time'
  offline?: boolean
  /** 命中设置页的免打扰 / 休息时段（dndRanges）：与提醒静默同源，桌宠直接躺下睡觉 */
  dnd?: boolean
  phase: MarketPhase
  pct: number | null
  thresholds: MoodThresholds
  roamActive?: boolean
  roamFacing?: 'left' | 'right'
}): PetState {
  if (input.alertActive) {
    const kind = input.alertKind ?? (input.alertDirection === 'down' ? 'down' : 'up')
    if (kind === 'time') return { action: 'alert-time', reason: 'alert', alertKind: 'time' }
    return kind === 'down'
      ? { action: 'panic-sad', reason: 'alert', alertKind: 'down' }
      : { action: 'panic-happy', reason: 'alert', alertKind: 'up' }
  }
  if (input.offline) return { action: 'offline', reason: 'offline' }
  // 免打扰优先于休市日与情绪：用户设这个时段就是不想被打扰，桌宠也一起睡
  if (input.dnd) return { action: 'sleepy', reason: 'dnd' }
  const o = restDayOverride(input.phase)
  if (o) return o
  const base = baseMoodState(input.pct, input.thresholds)
  return roamDecision(base, input.roamActive ?? false, input.roamFacing)
}
