import { limitRatioOf, limitPrices, limitStateOf, SpeedTracker, SPEED_WINDOW_MS } from './intraday.ts'
import assert from 'node:assert/strict'

/* ---------- 涨跌停幅度 ---------- */
assert.equal(limitRatioOf('600519', '贵州茅台', 1), 0.10)
assert.equal(limitRatioOf('000157', '中联重科', 0), 0.10)
assert.equal(limitRatioOf('300750', '宁德时代', 0), 0.20)
assert.equal(limitRatioOf('301111', '某创业板', 0), 0.20)
assert.equal(limitRatioOf('688981', '中芯国际', 1), 0.20)
assert.equal(limitRatioOf('830799', '北交所股', 0), 0.30)
assert.equal(limitRatioOf('600519', 'ST某某', 1), 0.05)
assert.equal(limitRatioOf('600519', '*ST某某', 1), 0.05)
// 港股 / 美股 / 场外基金不判定
assert.equal(limitRatioOf('00700', '腾讯', 116), 0)
assert.equal(limitRatioOf('AAPL', 'Apple', 105), 0)
assert.equal(limitRatioOf('110022', '某基金', 150), 0)

/* ---------- 限价与封板判定 ---------- */
const p = limitPrices(10, 0.1)
assert.equal(p.up, 11)
assert.equal(p.down, 9)
// 四舍五入到分
assert.equal(limitPrices(5.95, 0.1).up, 6.55)   // 6.545 → 6.55

assert.equal(limitStateOf({ price: 11, prevClose: 10, code: '600519', name: '茅台', market: 1 }), 'up')
// 差一分不算封板
assert.equal(limitStateOf({ price: 10.99, prevClose: 10, code: '600519', name: '茅台', market: 1 }), null)
assert.equal(limitStateOf({ price: 9, prevClose: 10, code: '600519', name: '茅台', market: 1 }), 'down')
assert.equal(limitStateOf({ price: 10.5, prevClose: 10, code: '600519', name: '茅台', market: 1 }), null)
assert.equal(limitStateOf({ price: 10.5, prevClose: null, code: '600519', name: '茅台', market: 1 }), null)
assert.equal(limitStateOf({ price: null, prevClose: 10, code: '600519', name: '茅台', market: 1 }), null)
// 创业板 20%：涨 10% 不算涨停
assert.equal(limitStateOf({ price: 11, prevClose: 10, code: '300750', name: '宁德', market: 0 }), null)
assert.equal(limitStateOf({ price: 12, prevClose: 10, code: '300750', name: '宁德', market: 0 }), 'up')

/* ---------- 涨速 ---------- */
const t0 = 1_700_000_000_000
const tracker = new SpeedTracker()
// 单点 → null
tracker.ingest([{ secId: 'a', price: 10 }], t0)
assert.equal(tracker.speedOf('a', t0), null)
// 跨度不足 45s → null（避免刚启动就报假异动）
tracker.ingest([{ secId: 'a', price: 10.5 }], t0 + 10_000)
assert.equal(tracker.speedOf('a', t0 + 10_000), null)
// 跨度够了 → 5%
tracker.ingest([{ secId: 'a', price: 10.5 }], t0 + 60_000)
assert.equal(tracker.speedOf('a', t0 + 60_000)!.toFixed(4), '5.0000')
// 下跌
const t2 = new SpeedTracker()
t2.ingest([{ secId: 'b', price: 20 }], t0)
t2.ingest([{ secId: 'b', price: 19 }], t0 + 60_000)
assert.equal(t2.speedOf('b', t0 + 60_000)!.toFixed(2), '-5.00')
// 1 秒内重复点被忽略
const t3 = new SpeedTracker()
t3.ingest([{ secId: 'c', price: 10 }], t0)
t3.ingest([{ secId: 'c', price: 99 }], t0 + 200)
t3.ingest([{ secId: 'c', price: 10 }], t0 + 60_000)
assert.equal(t3.speedOf('c', t0 + 60_000)!.toFixed(2), '0.00')
// 无效价格不入库
const t4 = new SpeedTracker()
t4.ingest([{ secId: 'd', price: null }], t0)
t4.ingest([{ secId: 'd', price: 0 }], t0 + 1000)
assert.equal(t4.size(), 0)
// 过期清理
const t5 = new SpeedTracker()
t5.ingest([{ secId: 'e', price: 10 }], t0)
t5.prune(t0 + SPEED_WINDOW_MS * 10)
assert.equal(t5.size(), 0)

console.log('intraday: all tests passed')
