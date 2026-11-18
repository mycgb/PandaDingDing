import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phaseOf, isTradingDay, nextPhaseBoundary, PHASE_INTERVAL } from '../src/market-calendar.ts'

// phaseOf
assert.equal(phaseOf(new Date('2026-11-16T09:00:00')), 'closed')       // 周一早9点前
assert.equal(phaseOf(new Date('2026-11-16T09:20:00')), 'preOpen')      // 竞价
assert.equal(phaseOf(new Date('2026-11-16T10:00:00')), 'continuous')
assert.equal(phaseOf(new Date('2026-11-16T12:00:00')), 'lunch')
assert.equal(phaseOf(new Date('2026-11-16T14:59:59')), 'continuous')
assert.equal(phaseOf(new Date('2026-11-16T15:01:00')), 'closed')
assert.equal(phaseOf(new Date('2026-11-15T10:00:00')), 'weekend')      // 周日
assert.equal(phaseOf(new Date('2026-02-17T10:00:00')), 'holiday')      // 春节
assert.equal(phaseOf(new Date('2026-11-16T11:29:59')), 'continuous')  // 边界前
assert.equal(phaseOf(new Date('2026-11-16T11:30:00')), 'lunch')        // 边界点

// isTradingDay
assert.equal(isTradingDay(new Date('2026-11-17T10:00:00')), true)
assert.equal(isTradingDay(new Date('2026-11-14T10:00:00')), false)     // 周六
assert.equal(isTradingDay(new Date('2026-01-01T10:00:00')), false)

// nextPhaseBoundary
const b1 = nextPhaseBoundary(new Date('2026-11-16T08:00:00'))
assert.equal(b1.getTime(), new Date('2026-11-16T09:15:00').getTime())
const b2 = nextPhaseBoundary(new Date('2026-11-16T16:00:00'))
assert.equal(b2.getTime(), new Date('2026-11-17T09:15:00').getTime())
const b3 = nextPhaseBoundary(new Date('2026-11-16T12:30:00'))
assert.equal(b3.getTime(), new Date('2026-11-16T13:00:00').getTime())

// PHASE_INTERVAL
assert.equal(PHASE_INTERVAL.continuous, 3000)
assert.equal(PHASE_INTERVAL.weekend, 0)

console.log('market-calendar: all tests passed')
