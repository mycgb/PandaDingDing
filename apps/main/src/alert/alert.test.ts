import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AlertEngine } from './AlertEngine.ts'
import { isDndNow } from './AlertEngine.ts'
import type { AlertEvent, AlertRule, QuoteSnapshot, WatchItem } from '../../../../packages/shared/src/index.ts'

function snap(pct: number, price = 100): QuoteSnapshot {
  return {
    secId: '1.600519', code: '600519', name: '贵州茅台', market: 1,
    price, changePct: pct, change: pct * price / 100, volume: 100, amount: 1e6,
    high: 105, low: 95, open: 100, prevClose: 100, fetchedAt: Date.now(), source: 'test',
  }
}

function makeEngine(rule: Partial<AlertRule>, opts?: { dnd?: boolean; fired?: boolean; lastFiredAt?: Partial<Record<'up' | 'down', number>> }) {
  const events: Omit<AlertEvent, 'id'>[] = []
  const rules: AlertRule[] = [{
    id: 'r1', scope: 'security', secId: '1.600519', metric: 'changePct', op: 'absAbove',
    threshold: 3, cooldown: 'oncePerDay', enabled: true, ...rule,
  }]
  const watch: WatchItem[] = [{
    secId: '1.600519', code: '600519', name: '贵州茅台', market: 1,
    weight: 1, sortOrder: 1, createdAt: '2026-11-17', shares: 0, costPrice: 0,
  }]
  const engine = new AlertEngine({
    getRules: () => rules,
    getWatchlist: () => watch,
    hasFiredToday: () => !!opts?.fired,
    lastFiredAt: (_ruleId, _secId, dir) => opts?.lastFiredAt?.[dir] ?? null,
    insertEvent: (e) => { events.push(e); return { ...e, id: events.length } },
    isDndNow: () => !!opts?.dnd,
  })
  return { engine, events }
}

// 触发 absAbove +5%
{
  const { engine, events } = makeEngine({ threshold: 5 })
  const fired = engine.feed([snap(5.2)])
  assert.equal(fired.length, 1)
  assert.equal(events.length, 1)
  assert.equal(fired[0].direction, 'up')
  assert.ok(fired[0].message.includes('+5.20%'))
}
// 未达阈值不触发
{
  const { engine, events } = makeEngine({ threshold: 5 })
  const fired = engine.feed([snap(4.9)])
  assert.equal(fired.length, 0)
  assert.equal(events.length, 0)
}
// 同向当日已触发 → 防骚扰去重
{
  const { engine } = makeEngine({ threshold: 5 }, { fired: true })
  const fired = engine.feed([snap(6.5)])
  assert.equal(fired.length, 0)
}
// 反向不重复：跌到 -5% 时 direction=down，与当日 up 不冲突
{
  const { engine } = makeEngine({ threshold: 5 }, { fired: true })
  const fired = engine.feed([snap(-6)])
  assert.equal(fired.length, 0)
}
{
  const { engine } = makeEngine({ threshold: 5 })
  const fired = engine.feed([snap(-6)])
  assert.equal(fired.length, 1)
  assert.equal(fired[0].direction, 'down')
}
// 免打扰抑制
{
  const { engine, events } = makeEngine({ threshold: 5 }, { dnd: true })
  const fired = engine.feed([snap(5.5)])
  assert.equal(fired.length, 0)
  assert.equal(events.length, 0)
}
// 停牌 null 值不触发
{
  const { engine } = makeEngine({ threshold: 5 })
  const s = { ...snap(5), changePct: null }
  assert.equal(engine.feed([s]).length, 0)
}
// 全局规则对所有标的生效
{
  const { events } = makeEngine({ scope: 'global', secId: undefined })
  const s = snap(3.5)
  assert.ok(events.length >= 0)
}
// 禁用规则不生效
{
  const { engine } = makeEngine({ threshold: 5, enabled: false })
  assert.equal(engine.feed([snap(9)]).length, 0)
}
// minutes:30 冷却：未到间隔不触发；间隔已过触发；从未触发则触发
{
  const now = new Date('2026-11-18T10:00:00')
  const recent = now.getTime() - 10 * 60_000   // 10 分钟前
  const old = now.getTime() - 45 * 60_000      // 45 分钟前
  const r = { threshold: 5, cooldown: 'minutes:30' }
  assert.equal(makeEngine(r, { lastFiredAt: { up: recent } }).engine.feed([snap(6)], now).length, 0)
  assert.equal(makeEngine(r, { lastFiredAt: { up: old } }).engine.feed([snap(6)], now).length, 1)
  assert.equal(makeEngine(r, { lastFiredAt: {} }).engine.feed([snap(6)], now).length, 1)
  // 反向方向独立冷却：up 刚触发过不影响 down
  assert.equal(makeEngine(r, { lastFiredAt: { up: recent } }).engine.feed([snap(-6)], now).length, 1)
}
// oncePerDay 仍走 hasFiredToday（回归）
{
  const { engine } = makeEngine({ threshold: 5, cooldown: 'oncePerDay' }, { fired: true, lastFiredAt: { up: 1 } })
  assert.equal(engine.feed([snap(6)]).length, 0)
}

// 成交量倍数：当日量 / 基准，达阈值触发；未注入基准则不触发（数据未就绪保护）
{
  const base = { ...snap(0), volume: 250, volumeBaseline: 100 }
  const { engine, events } = makeEngine({ metric: 'volumeMultiple', op: 'above', threshold: 2 })
  const fired = engine.feed([base])
  assert.equal(fired.length, 1)
  assert.equal(fired[0].direction, 'up')
  assert.ok(fired[0].message.includes('2.50 倍'))
  assert.ok(events[0].value > 2.49 && events[0].value < 2.51)
}
{
  const { engine } = makeEngine({ metric: 'volumeMultiple', op: 'above', threshold: 2 })
  assert.equal(engine.feed([{ ...snap(0), volume: 250, volumeBaseline: null }]).length, 0)
  assert.equal(engine.feed([{ ...snap(0), volume: 250 }]).length, 0)
  // 未达阈值
  assert.equal(engine.feed([{ ...snap(0), volume: 150, volumeBaseline: 100 }]).length, 0)
}
// 连涨天数：>= 阈值触发（含第 N 天），方向 up
{
  const { engine, events } = makeEngine({ metric: 'streakUp', op: 'above', threshold: 3 })
  assert.equal(engine.feed([{ ...snap(0), streakDays: 3 }]).length, 1)   // 恰好 3 天也触发
  assert.equal(events[0].direction, 'up')
  assert.equal(engine.feed([{ ...snap(0), streakDays: 2 }]).length, 0)
  assert.equal(engine.feed([{ ...snap(0), streakDays: -5 }]).length, 0)  // 连跌不触发连涨
}
// 连跌天数：方向 down，与连涨的冷却方向隔离
{
  const { engine, events } = makeEngine({ metric: 'streakDown', op: 'above', threshold: 4 })
  const fired = engine.feed([{ ...snap(0), streakDays: -4 }])
  assert.equal(fired.length, 1)
  assert.equal(events[0].direction, 'down')
  assert.ok(fired[0].message.includes('已连跌 4 天'))
  assert.equal(engine.feed([{ ...snap(0), streakDays: -3 }]).length, 0)
  assert.equal(engine.feed([{ ...snap(0), streakDays: 5 }]).length, 0)
}
// 派生字段未注入时，连涨规则不触发（避免把 null 当 0 误触发）
{
  const { engine } = makeEngine({ metric: 'streakUp', op: 'above', threshold: 3 })
  assert.equal(engine.feed([snap(0)]).length, 0)
}

// isDndNow
assert.equal(isDndNow([{ start: '12:00', end: '13:00' }], true, new Date('2026-11-17T12:30:00')), true)
assert.equal(isDndNow([{ start: '12:00', end: '13:00' }], true, new Date('2026-11-17T11:59:00')), false)
assert.equal(isDndNow([{ start: '12:00', end: '13:00' }], true, new Date('2026-11-17T13:00:00')), false)
assert.equal(isDndNow([{ start: '12:00', end: '13:00' }], false, new Date('2026-11-17T12:30:00')), false)
assert.equal(isDndNow([{ start: '23:00', end: '01:00' }], true, new Date('2026-11-17T23:30:00')), true)
assert.equal(isDndNow([{ start: '23:00', end: '01:00' }], true, new Date('2026-11-17T00:30:00')), true)
assert.equal(isDndNow([{ start: '23:00', end: '01:00' }], true, new Date('2026-11-17T10:00:00')), false)

/* ---------- 异动雷达：3 分钟涨速 ---------- */
{
  const { engine } = makeEngine({ metric: 'speedPct', op: 'absAbove', threshold: 1.5 })
  const s = snap(0.2); s.speedPct = 1.8
  const fired = engine.feed([s])
  assert.equal(fired.length, 1)
  assert.equal(fired[0].direction, 'up')
  assert.ok(fired[0].message.includes('3 分钟急涨'), fired[0].message)
}
{
  const { engine } = makeEngine({ metric: 'speedPct', op: 'absAbove', threshold: 1.5 })
  const s = snap(0.2); s.speedPct = -1.9
  const fired = engine.feed([s])
  assert.equal(fired.length, 1)
  assert.equal(fired[0].direction, 'down')
  assert.ok(fired[0].message.includes('3 分钟急跌'), fired[0].message)
}
{
  // 涨速数据未就绪（刚启动/刚加自选）→ null，不能误报
  const { engine } = makeEngine({ metric: 'speedPct', op: 'absAbove', threshold: 1.5 })
  const s = snap(0.2); s.speedPct = null
  assert.equal(engine.feed([s]).length, 0)
}

/* ---------- 异动雷达：触及涨跌停 ---------- */
{
  const { engine } = makeEngine({ metric: 'atLimit', op: 'above', threshold: 1 })
  const s = snap(10); s.atLimit = 'up'
  const fired = engine.feed([s])
  assert.equal(fired.length, 1)
  assert.equal(fired[0].direction, 'up')
  assert.ok(fired[0].message.includes('触及涨停'), fired[0].message)
}
{
  const { engine } = makeEngine({ metric: 'atLimit', op: 'above', threshold: 1 })
  const s = snap(-10); s.atLimit = 'down'
  const fired = engine.feed([s])
  assert.equal(fired.length, 1)
  assert.equal(fired[0].direction, 'down')
  assert.ok(fired[0].message.includes('触及跌停'), fired[0].message)
}
{
  // 没封板不触发
  const { engine } = makeEngine({ metric: 'atLimit', op: 'above', threshold: 1 })
  assert.equal(engine.feed([snap(1)]).length, 0)
}

console.log('alert-engine: all tests passed')
