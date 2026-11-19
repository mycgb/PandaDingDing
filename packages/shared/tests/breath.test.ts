import assert from 'node:assert/strict'
import { breathCurve } from '../src/breath.ts'

const T = 4000

// 端点：起点与终点都是 0（呼气末），不会跳变
assert.equal(breathCurve(0, T), 0)
assert.ok(Math.abs(breathCurve(T, T)) < 1e-12)
assert.ok(Math.abs(breathCurve(2 * T, T)) < 1e-12)

// 半周期：吸气峰值 1
assert.ok(Math.abs(breathCurve(T / 2, T) - 1) < 1e-12)

// 单调递增（0 → 半周期）
let prev = -1
for (let ms = 0; ms <= T / 2; ms += 50) {
  const v = breathCurve(ms, T)
  assert.ok(v >= prev - 1e-12, `non-monotonic at ${ms}`)
  prev = v
}

// 循环连续：接近周期末尾的值接近 0，且周期边界两侧连续
const eps = 1
assert.ok(breathCurve(T - eps, T) < 0.001)
assert.ok(Math.abs(breathCurve(T + eps, T) - breathCurve(eps, T)) < 0.001)

// 负时间与异常周期：不抛错、不产生 NaN
assert.ok(breathCurve(-500, T) >= 0)
assert.equal(breathCurve(100, 0), 0)
assert.equal(breathCurve(100, -1), 0)
assert.equal(breathCurve(Number.NaN, T), 0)

// 始终落在 0..1
for (let ms = 0; ms < 3 * T; ms += 37) {
  const v = breathCurve(ms, T)
  assert.ok(v >= 0 && v <= 1, `out of range at ${ms}: ${v}`)
}

console.log('breath: all tests passed')
