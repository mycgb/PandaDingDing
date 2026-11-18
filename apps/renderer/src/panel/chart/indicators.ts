/**
 * 技术指标纯函数：MACD / KDJ。
 * 输入为 K 线收盘价与高低价数组，输出与输入等长的指标数组（前期不足处为 null）。
 */

/** 指数移动平均，standard EMA（首值用首个数据点初始化） */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length === 0 || period <= 0) return out
  const k = 2 / (period + 1)
  let prev = values[0]
  out[0] = prev
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export interface MacdPoint {
  dif: number | null
  dea: number | null
  macd: number | null   // 柱状值 = (DIF - DEA) * 2
}

/** MACD(12,26,9) */
export function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): MacdPoint[] {
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const dif = closes.map((_, i) => {
    const f = emaFast[i], s = emaSlow[i]
    return f !== null && s !== null ? f - s : null
  })
  // DEA 是 DIF 的 EMA；EMA 函数不接受 null，用 0 占位但跳过前期
  const difNums = dif.map((v) => v ?? 0)
  const deaRaw = ema(difNums, signal)
  const dea = deaRaw.map((v, i) => (dif[i] === null ? null : v))
  return closes.map((_, i) => {
    const d = dif[i], de = dea[i]
    return { dif: d, dea: de, macd: d !== null && de !== null ? (d - de) * 2 : null }
  })
}

export interface KdjPoint {
  k: number | null
  d: number | null
  j: number | null
}

/** KDJ(9,3,3) */
export function calcKDJ(highs: number[], lows: number[], closes: number[], period = 9): KdjPoint[] {
  const out: KdjPoint[] = closes.map(() => ({ k: null, d: null, j: null }))
  if (closes.length < period) return out
  let prevK = 50, prevD = 50
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) continue
    let hh = -Infinity, ll = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      hh = Math.max(hh, highs[j])
      ll = Math.min(ll, lows[j])
    }
    const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100
    prevK = (2 / 3) * prevK + (1 / 3) * rsv
    prevD = (2 / 3) * prevD + (1 / 3) * prevK
    out[i] = { k: prevK, d: prevD, j: 3 * prevK - 2 * prevD }
  }
  return out
}
