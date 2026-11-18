import { test } from 'node:test'
import assert from 'node:assert/strict'
import { portfolioPct, resolvePetState, baseMoodState, phasePetOverride, roamDecision } from './petState.ts'
import type { QuoteSnapshot, WatchItem } from '../../../../packages/shared/src/index.ts'

const w = (secId: string, weight = 1): WatchItem => ({
  secId, code: secId.split('.')[1], name: secId, market: 1, weight, sortOrder: 1, createdAt: '',
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

// phase override
assert.equal(phasePetOverride('closed')?.action, 'sleepy')
assert.equal(phasePetOverride('weekend')?.action, 'sleepy')
assert.equal(phasePetOverride('continuous'), null)

// resolvePetState 优先级
const th = { up: 0.5, down: -0.5 }
assert.equal(resolvePetState({ alertActive: true, alertDirection: 'up', phase: 'continuous', pct: 0, thresholds: th }).action, 'panic-happy')
assert.equal(resolvePetState({ alertActive: true, alertDirection: 'down', phase: 'continuous', pct: 0, thresholds: th }).action, 'panic-sad')
assert.equal(resolvePetState({ offline: true, phase: 'continuous', pct: 5, thresholds: th }).action, 'offline')
// 盘后不再静止：降速播放 sleepy
assert.equal(resolvePetState({ phase: 'closed', pct: 5, thresholds: th }).action, 'sleepy')
assert.equal(resolvePetState({ phase: 'weekend', pct: -5, thresholds: th }).action, 'sleepy')
assert.equal(resolvePetState({ phase: 'holiday', pct: -5, thresholds: th }).action, 'sleepy')
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
assert.equal(resolvePetState({ phase: 'closed', pct: 0, thresholds: th, roamActive: true }).action, 'sleepy')

console.log('pet-state: all tests passed')
