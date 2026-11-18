import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ema, calcMACD, calcKDJ } from '../../../apps/renderer/src/panel/chart/indicators.ts'

// EMA 基本行为
const e = ema([1, 2, 3, 4, 5], 3)
assert.equal(e[0], 1)
assert.ok(e[4]! > e[0]!)  // 递增序列 EMA 递增
assert.equal(e.length, 5)

// MACD：恒定价格 DIF/DEA 收敛到 0
const flat = calcMACD(new Array(60).fill(10))
assert.ok(Math.abs(flat[59].dif!) < 1e-6)
assert.ok(Math.abs(flat[59].dea!) < 1e-6)
assert.ok(Math.abs(flat[59].macd!) < 1e-6)

// MACD：上升趋势 DIF > 0
const up = calcMACD(Array.from({ length: 60 }, (_, i) => i + 10))
assert.ok(up[59].dif! > 0)
assert.ok(up[59].dea! > 0)

// KDJ：前期不足 9 根为 null
const kdj = calcKDJ([10,11,12],[9,10,11],[10,11,12], 9)
assert.equal(kdj[0].k, null)
assert.equal(kdj.length, 3)
assert.ok(kdj.every((p) => p.k === null && p.d === null && p.j === null))  // 不足 9 根，全 null

// KDJ：充分数据后 K/D/J 在合理范围
const highs = Array.from({ length: 30 }, (_, i) => 100 + i)
const lows = Array.from({ length: 30 }, (_, i) => 95 + i)
const closes = Array.from({ length: 30 }, (_, i) => 98 + i)
const k2 = calcKDJ(highs, lows, closes)
assert.ok(k2[29].k !== null && k2[29].k! >= 0 && k2[29].k! <= 100)
assert.ok(k2[29].d !== null && k2[29].d! >= 0 && k2[29].d! <= 100)
assert.ok(Math.abs(k2[29].j! - (3 * k2[29].k! - 2 * k2[29].d!)) < 1e-6)

console.log('indicators: all tests passed')
