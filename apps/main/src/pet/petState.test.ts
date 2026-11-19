import { test } from 'node:test'
import assert from 'node:assert/strict'
import { portfolioPct, resolvePetState, baseMoodState, restDayOverride, roamDecision } from './petState.ts'
import type { QuoteSnapshot, WatchItem } from '../../../../packages/shared/src/index.ts'

const w = (secId: string, weight = 1): WatchItem => ({
  secId, code: secId.split('.')[1], name: secId, market: 1, weight, sortOrder: 1, createdAt: '', shares: 0, costPrice: 0,
})
const s = (secId: string, pct: number | null): QuoteSnapshot => ({
  secId, code: secId.split('.')[1], name: secId, market: 1,
  price: 100, changePct: pct, change: pct, volume: 1, amount: 1,
  high: 1, low: 1, open: 1, prevClose: 1, fetchedAt: 0, source: 't',
})

// 等权
assert.equal(portfolioPct([s('1.A', 1), s('1.B', -1)], [w('1.A'), w('1.B')]), 0)
// 加权
assert.equal(portfolioPct([s('1.A', 2), s('1.B', 0)], [w('1.A', 2), w('1.B', 1)]), 4 / 3)
// 停牌剔除
assert.equal(portfolioPct([s('1.A', 3), s('1.B', null)], [w('1.A'), w('1.B')]), 3)
// 全停牌 → null
assert.equal(portfolioPct([s('1.A', null)], [w('1.A')]), null)
// 空列表 → null
assert.equal(portfolioPct([], []), null)

// baseMoodState
assert.equal(baseMoodState(1.2, { up: 0.5, down: -0.5 }).action, 'idle-smile')
assert.equal(baseMoodState(-1.2, { up: 0.5, down: -0.5 }).action, 'idle-frown')
assert.equal(baseMoodState(0.2, { up: 0.5, down: -0.5 }).action, 'idle')
assert.equal(baseMoodState(null, { up: 0.5, down: -0.5 }).action, 'idle')

// 休市日覆盖：周末/节假日睡觉；交易日不再由代码决定睡不睡（交给免打扰列表）
assert.equal(restDayOverride('weekend')?.action, 'sleepy')
assert.equal(restDayOverride('holiday')?.action, 'sleepy')
assert.equal(restDayOverride('closed'), null)
assert.equal(restDayOverride('lunch'), null)
assert.equal(restDayOverride('continuous'), null)

// resolvePetState 优先级
const th = { up: 0.5, down: -0.5 }
assert.equal(resolvePetState({ alertActive: true, alertDirection: 'up', phase: 'continuous', pct: 0, thresholds: th }).action, 'panic-happy')
assert.equal(resolvePetState({ alertActive: true, alertDirection: 'down', phase: 'continuous', pct: 0, thresholds: th }).action, 'panic-sad')
// 提醒类型决定动作：定时时点提醒用慢摇（alert-time），规则涨跌用欢呼/摇头
assert.equal(resolvePetState({ alertActive: true, alertKind: 'time', phase: 'continuous', pct: 0, thresholds: th }).action, 'alert-time')
assert.equal(resolvePetState({ alertActive: true, alertKind: 'time', phase: 'continuous', pct: 0, thresholds: th }).alertKind, 'time')
assert.equal(resolvePetState({ alertActive: true, alertKind: 'down', alertDirection: 'up', phase: 'continuous', pct: 0, thresholds: th }).action, 'panic-sad')
assert.equal(resolvePetState({ alertActive: true, alertKind: 'up', alertDirection: 'down', phase: 'continuous', pct: 0, thresholds: th }).action, 'panic-happy')
assert.equal(resolvePetState({ alertActive: true, alertKind: 'time', alertDirection: 'down', phase: 'continuous', pct: 0, thresholds: th }).action, 'alert-time')
assert.equal(resolvePetState({ offline: true, phase: 'continuous', pct: 5, thresholds: th }).action, 'offline')
// 休市日：不经免打扰也睡
assert.equal(resolvePetState({ phase: 'weekend', pct: -5, thresholds: th }).action, 'sleepy')
assert.equal(resolvePetState({ phase: 'holiday', pct: -5, thresholds: th }).action, 'sleepy')
// 交易日的午休/盘后不再自动睡：没命中休息时段就按情绪站着
assert.equal(resolvePetState({ phase: 'lunch', pct: 5, thresholds: th }).action, 'idle-smile')
assert.equal(resolvePetState({ phase: 'closed', pct: 5, thresholds: th }).action, 'idle-smile')
assert.equal(resolvePetState({ phase: 'preOpen', pct: 0, thresholds: th }).action, 'idle')
// 但命中休息时段（免打扰列表里的午休/夜间）就躺下
assert.equal(resolvePetState({ phase: 'lunch', pct: 5, thresholds: th, dnd: true }).action, 'sleepy')
assert.equal(resolvePetState({ phase: 'closed', pct: 5, thresholds: th, dnd: true }).action, 'sleepy')
assert.equal(resolvePetState({ phase: 'continuous', pct: 5, thresholds: th }).action, 'idle-smile')
assert.equal(resolvePetState({ phase: 'continuous', pct: -5, thresholds: th }).action, 'idle-frown')

// roamDecision：只在中性 idle 且放行时接管为 walk，带朝向
assert.equal(roamDecision({ action: 'idle' }, false).action, 'idle')
assert.equal(roamDecision({ action: 'idle' }, true).action, 'walk')
assert.equal(roamDecision({ action: 'idle' }, true, 'left').facing, 'left')
// 有明确情绪时不被漫游覆盖
assert.equal(roamDecision({ action: 'idle-smile' }, true).action, 'idle-smile')
assert.equal(roamDecision({ action: 'idle-frown' }, true).action, 'idle-frown')

// resolvePetState 漫游集成：中性 + 放行 → walk
assert.equal(resolvePetState({ phase: 'continuous', pct: 0, thresholds: th, roamActive: true }).action, 'walk')
// 提醒/离线/盘后仍优先于漫游
assert.equal(resolvePetState({ alertActive: true, phase: 'continuous', pct: 0, thresholds: th, roamActive: true }).action, 'panic-happy')
assert.equal(resolvePetState({ offline: true, phase: 'continuous', pct: 0, thresholds: th, roamActive: true }).action, 'offline')
assert.equal(resolvePetState({ phase: 'weekend', pct: 0, thresholds: th, roamActive: true }).action, 'sleepy')
// 休息时段内也不漫游
assert.equal(resolvePetState({ phase: 'lunch', pct: 0, thresholds: th, roamActive: true, dnd: true }).action, 'sleepy')

// 免打扰（设置页 dndRanges）：命中即躺下睡，优先于情绪与漫游
assert.equal(resolvePetState({ phase: 'continuous', pct: 5, thresholds: th, dnd: true }).action, 'sleepy')
assert.equal(resolvePetState({ phase: 'continuous', pct: 5, thresholds: th, dnd: true }).reason, 'dnd')
assert.equal(resolvePetState({ phase: 'continuous', pct: -5, thresholds: th, dnd: true }).action, 'sleepy')
assert.equal(resolvePetState({ phase: 'continuous', pct: 0, thresholds: th, dnd: true, roamActive: true }).action, 'sleepy')
// 免打扰不压过提醒与离线
assert.equal(resolvePetState({ alertActive: true, alertDirection: 'down', dnd: true, phase: 'continuous', pct: 0, thresholds: th }).action, 'panic-sad')
assert.equal(resolvePetState({ offline: true, dnd: true, phase: 'continuous', pct: 0, thresholds: th }).action, 'offline')
// 关掉免打扰后恢复正常情绪
assert.equal(resolvePetState({ phase: 'continuous', pct: 5, thresholds: th, dnd: false }).action, 'idle-smile')

console.log('pet-state: all tests passed')
