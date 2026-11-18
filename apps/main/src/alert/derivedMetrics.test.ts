import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeStreak, computeVolumeBaseline, tradingProgress, enrichDerived } from './derivedMetrics.ts'
import type { AlertRule, QuoteSnapshot } from '../../../../packages/shared/src/index.ts'

// 连涨连跌：正=连涨天数，负=连跌天数
{
  assert.equal(computeStreak([10, 11, 12, 13]), 3, '连续 3 天上涨')
  assert.equal(computeStreak([13, 12, 11]), -2, '连续 2 天下跌')
  assert.equal(computeStreak([10, 10, 10]), 0, '平盘')
  assert.equal(computeStreak([10, 12, 11, 10]), -2, '先涨后连跌2天')
  assert.equal(computeStreak([10]), 0, '数据不足')
  assert.equal(computeStreak([0, 11, 12]), 1, '过滤非法价格')
}
// 成交量基准：排除当日（最后一根），近5日均量
{
  assert.equal(computeVolumeBaseline([100, 100, 100, 100, 100, 100]), 100, '6根→排除最后1根取5根')
  assert.equal(computeVolumeBaseline([10, 20, 30, 40, 50, 9999]), 30, '排除当日异常量')
  assert.equal(computeVolumeBaseline([100, 100, 100, 100, 100]), 100, '5根→取前4根')
  assert.equal(computeVolumeBaseline([100]), null, '数据不足')
  assert.equal(computeVolumeBaseline([]), null, '空')
}
// 交易进度折算
{
  const p = tradingProgress(new Date('2026-11-18T10:30:00'))
  assert.ok(Math.abs(p - 0.25) < 0.001, `盘中进度应为0.25，实际${p}`)  // 10:30 已过 60 分钟 / 240
  assert.equal(tradingProgress(new Date('2026-11-18T16:00:00')), 1, '收盘=1')
  assert.equal(tradingProgress(new Date('2026-11-18T09:20:00')), 0.1, '盘前=0.1下限')
  assert.equal(tradingProgress(new Date('2026-11-21T10:30:00')), 1, '周末=1')
}
// enrichDerived：无相关规则时零开销（不触碰快照、不调 kline）
{
  const s: QuoteSnapshot = { secId: '1.600519', code: '600519', name: '茅台', market: 1, price: 100,
    changePct: 1, change: 1, volume: 100, amount: 1e6, high: 100, low: 99, open: 99, prevClose: 99,
    fetchedAt: Date.now(), source: 'test' }
  let called = false
  const fakeKline = { fetch: async () => { called = true; return [] } } as never
  const rule: AlertRule = { id: 'r1', scope: 'global', metric: 'changePct', op: 'above',
    threshold: 5, cooldown: 'oncePerDay', enabled: true }
  await enrichDerived([s], [rule], fakeKline, new Date('2026-11-18T10:30:00'))
  assert.equal(called, false, '无关指标不应拉K线')
  assert.equal(s.streakDays, undefined)
}
// enrichDerived：streakUp 规则注入 streakDays（用假 KlineService）
{
  const s: QuoteSnapshot = { secId: '1.600519', code: '600519', name: '茅台', market: 1, price: 100,
    changePct: 1, change: 1, volume: 500, amount: 1e6, high: 100, low: 99, open: 99, prevClose: 99,
    fetchedAt: Date.now(), source: 'test' }
  const klines = [10, 11, 12, 13].map((close, i) => ({ time: `2026-11-1${i}`, open: close, close,
    high: close, low: close, volume: 100 + i, amount: 0, amplitude: 0 }))
  const fakeKline = { fetch: async () => klines } as never
  const rule: AlertRule = { id: 'r1', scope: 'security', secId: '1.600519', metric: 'streakUp', op: 'above',
    threshold: 3, cooldown: 'oncePerDay', enabled: true }
  await enrichDerived([s], [rule], fakeKline, new Date('2026-11-18T15:30:00'))
  assert.equal(s.streakDays, 3)
  assert.ok(s.volumeBaseline && s.volumeBaseline > 0, '同时注入成交量基准')
}

console.log('derived-metrics: all tests passed')
