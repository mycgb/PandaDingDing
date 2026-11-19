import { calcPosition, sumPositions, positionWeight } from '../src/position.ts'
import assert from 'node:assert/strict'

// 未持仓 / 无现价 → null
assert.equal(calcPosition({ shares: 0, costPrice: 5, price: 6, prevClose: 5.5 }), null)
assert.equal(calcPosition({ shares: -100, costPrice: 5, price: 6, prevClose: 5.5 }), null)
assert.equal(calcPosition({ shares: 100, costPrice: 5, price: null, prevClose: 5.5 }), null)
assert.equal(calcPosition({ shares: 100, costPrice: 5, price: 0, prevClose: 5.5 }), null)

// 基本计算：100 股，成本 5，现价 6，昨收 5.5
const a = calcPosition({ shares: 100, costPrice: 5, price: 6, prevClose: 5.5 })!
assert.equal(a.marketValue, 600)
assert.equal(a.costValue, 500)
assert.equal(a.dayPnl, 50)      // 100 × (6 − 5.5)
assert.equal(a.totalPnl, 100)   // 100 × (6 − 5)
assert.equal(a.dayPct!.toFixed(4), '9.0909')
assert.equal(a.totalPct!, 20)

// 负成本/无成本：累计盈亏记 0，不当成“白赚”
const noCost = calcPosition({ shares: 200, costPrice: 0, price: 3, prevClose: 2.9 })!
assert.equal(noCost.totalPnl, 0)
assert.equal(noCost.totalPct, null)
assert.equal(noCost.costValue, 600)   // 按现价计成本

// 无昨收（如场外基金首日）→ 当日盈亏 0
const noPrev = calcPosition({ shares: 100, costPrice: 1, price: 1.2, prevClose: null })!
assert.equal(noPrev.dayPnl, 0)
assert.equal(noPrev.dayPct, null)

// 下跌为负
const d = calcPosition({ shares: 1000, costPrice: 10, price: 9, prevClose: 9.5 })!
assert.equal(d.dayPnl, -500)
assert.equal(d.totalPnl, -1000)

// 汇总
const p1 = calcPosition({ shares: 100, costPrice: 5, price: 6, prevClose: 5.5 })!
const p2 = calcPosition({ shares: 200, costPrice: 10, price: 9, prevClose: 9.5 })!
const sum = sumPositions([p1, p2])
assert.equal(sum.marketValue, 600 + 1800)
assert.equal(sum.dayPnl, 50 - 100)
assert.equal(sum.totalPnl, 100 - 200)
assert.equal(sum.count, 2)
assert.equal(sumPositions([]).count, 0)

// 仓位占比
assert.equal(positionWeight(600, 2400), 25)
assert.equal(positionWeight(600, 0), null)
assert.equal(positionWeight(Number.NaN, 100), null)

console.log('position: all tests passed')
