import { test } from 'node:test'
import assert from 'node:assert/strict'
import { badgeKindOf, tally, buildTooltip, decideBadge, type BadgeInput } from './trayBadge.ts'
import type { QuoteSnapshot } from '../../../../packages/shared/src/index.ts'

const s = (pct: number | null): QuoteSnapshot => ({
  secId: '1.A', code: 'A', name: 'A', market: 1,
  price: 1, changePct: pct, change: pct, volume: 1, amount: 1,
  high: 1, low: 1, open: 1, prevClose: 1, fetchedAt: 0, source: 't',
})

// 配色档位（A股：涨红跌绿）
assert.equal(badgeKindOf(1.2, false, false, true), 'up')
assert.equal(badgeKindOf(-1.2, false, false, true), 'down')
assert.equal(badgeKindOf(0.001, false, false, true), 'flat')
assert.equal(badgeKindOf(null, false, false, true), 'flat')
// 提醒优先于涨跌
assert.equal(badgeKindOf(5, true, false, true), 'alert')
// 关闭角标
assert.equal(badgeKindOf(5, false, false, false), 'none')

// 红绿平统计（停牌 null 不计入）
assert.deepEqual(tally([s(1), s(-2), s(0), s(null)]), { up: 1, down: 1, flat: 1 })

const base: BadgeInput = {
  pct: 1.23, alerting: false, offline: false, enabled: true,
  source: '东方财富', snapshots: [s(1), s(-2), s(0.5)],
}

test('buildTooltip: 组合涨跌 + 红绿平 + 数据源', () => {
  const t = buildTooltip(base)
  assert.ok(t.includes('+1.23%'), t)
  assert.ok(t.includes('2红1绿'), t)
  assert.ok(t.includes('东方财富'), t)
})

test('buildTooltip: 离线与穿透提示', () => {
  const t = buildTooltip({ ...base, pct: null, offline: true, clickThrough: true })
  assert.ok(t.includes('数据源离线'), t)
  assert.ok(t.includes('点击穿透中'), t)
})

test('decideBadge: 各态图标与 tooltip 联动', () => {
  assert.equal(decideBadge(base).iconFile, 'tray-up.png')
  assert.equal(decideBadge({ ...base, pct: -3 }).iconFile, 'tray-down.png')
  assert.equal(decideBadge({ ...base, alerting: true }).iconFile, 'tray-alert.png')
  assert.equal(decideBadge({ ...base, enabled: false }).iconFile, null)
  assert.equal(decideBadge({ ...base, enabled: false }).kind, 'none')
})

console.log('tray-badge: all tests passed')
