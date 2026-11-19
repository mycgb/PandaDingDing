/**
 * 呼吸曲线：一个周期内 0 → 1 → 0，采用 (1 - cos) / 2。
 * 与 sin 的区别在于两端速度为 0、且不会出现负值，因此
 *   - 循环首尾天然衔接，不会"顿一下"；
 *   - 只在基准姿态之上做放大，不会把角色缩到地平面以下。
 * 返回 0..1，用于缩放幅度插值。
 */
export function breathCurve(elapsedMs: number, periodMs: number): number {
  if (!(periodMs > 0) || !Number.isFinite(elapsedMs)) return 0
  const p = ((elapsedMs % periodMs) + periodMs) % periodMs
  return (1 - Math.cos((2 * Math.PI * p) / periodMs)) / 2
}
