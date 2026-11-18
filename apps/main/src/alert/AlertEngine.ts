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
    let value: number | null = null
    switch (rule.metric) {
      case 'changePct': value = s.changePct; break
      case 'price': value = s.price; break
      case 'volumeMultiple': return null  // MVP 暂不启用
    }
    if (value === null || value === undefined) return null
    switch (rule.op) {
      case 'above':
        if (value > rule.threshold)
          return ['up', value, `${s.name} ${fmt(value)} 已高于阈值 ${rule.threshold}`]
        return null
      case 'below':
        if (value < rule.threshold)
          return ['down', value, `${s.name} ${fmt(value)} 已低于阈值 ${rule.threshold}`]
        return null
      case 'absAbove':
        if (Math.abs(value) >= rule.threshold) {
          const dir: 'up' | 'down' = value >= 0 ? 'up' : 'down'
          return [dir, value, `${s.name} ${fmt(value)} 已达阈值 ±${rule.threshold}`]
        }
        return null
    }
    return null
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
