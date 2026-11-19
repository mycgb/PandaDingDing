import { EventEmitter } from 'node:events'
import type { AlertEvent, AlertRule, QuoteSnapshot, WatchItem } from '../../../../packages/shared/src/index.ts'

export interface AlertEngineDeps {
  getRules(): AlertRule[]
  getWatchlist(): WatchItem[]
  hasFiredToday(secId: string, direction: 'up' | 'down'): boolean
  /** 该规则+标的+方向最近一次触发时间（epoch ms）；minutes 冷却用。未提供则退化为当日判断 */
  lastFiredAt?(ruleId: string, secId: string, direction: 'up' | 'down'): number | null
  insertEvent(e: Omit<AlertEvent, 'id'>): AlertEvent
  isDndNow(now?: Date): boolean
  log?: (...a: unknown[]) => void
}

/** 提醒引擎（文档 §8.2）：规则判定 + 防骚扰 + 免打扰过滤 */
export class AlertEngine extends EventEmitter {
  private deps: AlertEngineDeps
  constructor(deps: AlertEngineDeps) { super(); this.deps = deps }

  /** 喂入一批快照，返回并对外发射触发的提醒事件 */
  feed(snapshots: QuoteSnapshot[], now: Date = new Date()): AlertEvent[] {
    const rules = this.deps.getRules().filter((r) => r.enabled)
    if (rules.length === 0) return []
    const bySec = new Map(snapshots.map((s) => [s.secId, s]))
    const watchByName = new Map(this.deps.getWatchlist().map((w) => [w.secId, w.name]))
    const fired: AlertEvent[] = []

    for (const rule of rules) {
      const targets = rule.scope === 'global'
        ? snapshots
        : [bySec.get(rule.secId!)].filter(Boolean) as QuoteSnapshot[]
      for (const snap of targets) {
        const hit = this.evaluate(rule, snap)
        if (!hit) continue
        const [dir, value, msg] = hit
        if (this.inCooldown(rule, snap.secId, dir, now)) continue
        if (this.deps.isDndNow(now)) {
          this.deps.log?.('[Alert] suppressed by DND:', snap.secId)
          continue
        }
        const event = this.deps.insertEvent({
          secId: snap.secId,
          secName: snap.name || watchByName.get(snap.secId) || snap.secId,
          ruleId: rule.id,
          direction: dir,
          value,
          message: msg,
          triggeredAt: now.toISOString(),
        })
        fired.push(event)
        this.emit('alert', event)
      }
    }
    return fired
  }

  /** 冷却判定：minutes:N 按规则+标的+方向的最近触发时间；其余（oncePerDay 等）按当日同向一次 */
  private inCooldown(rule: AlertRule, secId: string, dir: 'up' | 'down', now: Date): boolean {
    const m = /^minutes:(\d+)$/.exec(rule.cooldown)
    if (!m) return this.deps.hasFiredToday(secId, dir)
    const minutes = Number(m[1])
    if (!Number.isFinite(minutes) || minutes <= 0) return this.deps.hasFiredToday(secId, dir)
    const last = this.deps.lastFiredAt?.(rule.id, secId, dir) ?? null
    if (last === null) return false
    return now.getTime() - last < minutes * 60_000
  }

  private evaluate(rule: AlertRule, s: QuoteSnapshot): ['up' | 'down', number, string] | null {
    // 触及涨跌停：开关型信号，不看阈值（value 只用于记录方向）
    if (rule.metric === 'atLimit') {
      const price = s.price == null ? '' : ` ${s.price.toFixed(2)}`
      if (s.atLimit === 'up') return ['up', 1, `${s.name} 触及涨停${price}`]
      if (s.atLimit === 'down') return ['down', -1, `${s.name} 触及跌停${price}`]
      return null
    }
    const derived = metricValue(rule.metric, s)
    if (derived === null) return null
    const { value, label } = derived
    // 连涨/连跌天数语义是「达到 N 天」→ 用 >=；其余指标保持原有 above/below/absAbove 语义
    const aboveHit = rule.metric === 'streakUp' || rule.metric === 'streakDown'
      ? value >= rule.threshold
      : value > rule.threshold
    const dir = directionOf(rule.metric, value)
    const unit = rule.metric === 'streakUp' || rule.metric === 'streakDown' ? ' 天'
      : rule.metric === 'changePct' || rule.metric === 'speedPct' ? '%'
        : ''
    switch (rule.op) {
      case 'above':
        if (aboveHit) return [dir, value, `${s.name} ${label}，达到阈值 ${rule.threshold}${unit}`]
        return null
      case 'below':
        if (value < rule.threshold) return [dir, value, `${s.name} ${label}，低于阈值 ${rule.threshold}${unit}`]
        return null
      case 'absAbove':
        if (Math.abs(value) >= rule.threshold)
          return [dir, value, `${s.name} ${label}，绝对值达到 ±${rule.threshold}${unit}`]
        return null
    }
    return null
  }
}

/** 触发方向：连跌指标固定 down，连涨/up 类固定 up，其余按数值符号 */
function directionOf(metric: AlertRule['metric'], value: number): 'up' | 'down' {
  if (metric === 'streakDown') return 'down'
  if (metric === 'streakUp') return 'up'
  return value >= 0 ? 'up' : 'down'
}

/** 取指标当前值与展示文本；数据未就绪（如派生字段未注入）返回 null */
function metricValue(metric: AlertRule['metric'], s: QuoteSnapshot): { value: number; label: string } | null {
  switch (metric) {
    case 'changePct':
      return s.changePct == null ? null : { value: s.changePct, label: `涨跌幅 ${fmt(s.changePct)}` }
    case 'price':
      return s.price == null ? null : { value: s.price, label: `价格 ${s.price.toFixed(2)} 元` }
    case 'volumeMultiple': {
      if (s.volume == null || s.volumeBaseline == null || s.volumeBaseline <= 0) return null
      const ratio = s.volume / s.volumeBaseline
      return { value: ratio, label: `成交量 ${ratio.toFixed(2)} 倍` }
    }
    case 'streakUp':
      return s.streakDays == null ? null : { value: s.streakDays, label: `已连涨 ${s.streakDays} 天` }
    case 'streakDown':
      return s.streakDays == null ? null : { value: -s.streakDays, label: `已连跌 ${-s.streakDays} 天` }
    case 'speedPct':
      // 近 3 分钟涨跌：由主进程的 SpeedTracker 注入
      return s.speedPct == null ? null : { value: s.speedPct, label: `3 分钟急${s.speedPct >= 0 ? '涨' : '跌'} ${fmt(s.speedPct)}` }
    case 'atLimit':
      return null   // 在上面特判，不走阈值比较
  }
}

function fmt(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}${Math.abs(v) < 100 ? '%' : ''}`
}

/* ---------- 免打扰判定（可测试纯函数） ---------- */

export function isDndNow(ranges: { start: string; end: string }[], enabled: boolean, now: Date): boolean {
  if (!enabled || ranges.length === 0) return false
  const t = now.getHours() * 60 + now.getMinutes()
  for (const r of ranges) {
    const [sh, sm] = r.start.split(':').map(Number)
    const [eh, em] = r.end.split(':').map(Number)
    const s = sh * 60 + sm, e = eh * 60 + em
    if (s <= e) {
      if (t >= s && t < e) return true
    } else {
      // 跨午夜
      if (t >= s || t < e) return true
    }
  }
  return false
}
