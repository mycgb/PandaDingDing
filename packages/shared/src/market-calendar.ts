/** 交易时段与交易日历（Asia/Shanghai），纯函数便于单元测试 */

export type MarketPhase = 'preOpen' | 'continuous' | 'lunch' | 'closed' | 'weekend' | 'holiday'

/** 分钟数转 HH:mm */
function hmToMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

/** 2026-2027 A股法定节假日（闭市日，含调休上班的周末仍闭市——按交易所公告口径） */
const HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-02', // 元旦
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', // 春节（初一0217）
  '2026-04-06', '2026-04-07', // 清明
  '2026-05-01', '2026-05-04', '2026-05-05', // 劳动节
  '2026-06-19', '2026-06-22', // 端午
  '2026-09-25', '2026-09-28', // 中秋
  '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', // 国庆
  // 2027（暂按常规预测，交付前以交易所公告更新）
  '2027-01-01',
  '2027-02-08', '2027-02-09', '2027-02-10', '2027-02-11',
  '2027-04-05', '2027-05-03', '2027-05-04', '2027-06-09', '2027-06-10',
  '2027-09-22', '2027-10-01', '2027-10-04', '2027-10-05',
])

export function isHoliday(date: Date): boolean {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return HOLIDAYS.has(`${y}-${m}-${d}`)
}

export function isTradingDay(date: Date): boolean {
  const day = date.getDay()
  if (day === 0 || day === 6) return false
  return !isHoliday(date)
}

/** 判定某时刻的时段 */
export function phaseOf(date: Date): MarketPhase {
  if (!isTradingDay(date)) {
    return date.getDay() === 0 || date.getDay() === 6 ? 'weekend' : 'holiday'
  }
  const t = date.getHours() * 60 + date.getMinutes()
  if (t >= hmToMin('09:15') && t < hmToMin('09:30')) return 'preOpen'
  if (t >= hmToMin('09:30') && t < hmToMin('11:30')) return 'continuous'
  if (t >= hmToMin('11:30') && t < hmToMin('13:00')) return 'lunch'
  if (t >= hmToMin('13:00') && t < hmToMin('15:00')) return 'continuous'
  return 'closed'
}

/** 各时段的轮询间隔（ms） */
export const PHASE_INTERVAL: Record<MarketPhase, number> = {
  preOpen: 5000,
  continuous: 3000,
  lunch: 30000,
  closed: 60000,
  weekend: 0,
  holiday: 0,
}

/** 下一次时段边界（用于 setTimeout 精确迁移，避免固定间隔漂移） */
export function nextPhaseBoundary(now: Date): Date {
  const d = new Date(now)
  const t = now.getHours() * 60 + now.getMinutes()
  const boundaries = ['09:15', '09:30', '11:30', '13:00', '15:00']
  let target: number | null = null
  for (const b of boundaries) {
    const bm = hmToMin(b)
    if (t < bm) { target = bm; break }
  }
  if (target === null) {
    // 明日 09:15
    d.setDate(d.getDate() + 1)
    d.setHours(9, 15, 0, 0)
    return d
  }
  const cur = t * 60_000 + now.getSeconds() * 1000 + now.getMilliseconds()
  const diff = target * 60_000 - cur
  return new Date(now.getTime() + diff)
}
