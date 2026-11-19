/** better-sqlite3 封装：迁移 + 各仓储。主进程专用。 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_SETTINGS, type AlertRule, type AppSettings, type AlertEvent, type WatchItem, type MarketType,
  type ClosingReport, type TimeAlert,
} from '../../../../packages/shared/src/index.ts'

type Row = Record<string, unknown>

const MIGRATIONS: { version: number; file: string }[] = [
  { version: 1, file: '001_init.sql' },
  { version: 2, file: '002_closing_reports.sql' },
  { version: 3, file: '003_time_alerts.sql' },
]

export class DataStore {
  private db: Database.Database

  constructor(dbPath: string, migrationsDir: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate(migrationsDir)
  }

  private migrate(dir: string): void {
    const current = (this.db.pragma('user_version') as unknown as { user_version: number }[])[0].user_version
    for (const m of MIGRATIONS.filter((m) => m.version > current)) {
      const sql = fs.readFileSync(path.join(dir, m.file), 'utf8')
      this.db.exec(sql)
      this.db.pragma(`user_version = ${m.version}`)
    }
  }

  close(): void { this.db.close() }

  /* ---------- watchlist ---------- */

  listWatchlist(): WatchItem[] {
    const rows = this.db.prepare('SELECT * FROM watchlist ORDER BY sort_order ASC').all() as Row[]
    return rows.map((r) => ({
      secId: String(r.sec_id), code: String(r.code), name: String(r.name),
      market: Number(r.market_type) as MarketType, weight: Number(r.weight),
      sortOrder: Number(r.sort_order), createdAt: String(r.created_at),
    }))
  }

  addWatchlist(secId: string, name: string, market: MarketType): WatchItem {
    const exists = this.db.prepare('SELECT sec_id FROM watchlist WHERE sec_id = ?').get(secId)
    if (exists) throw new Error('DUPLICATE')
    const max = this.db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM watchlist').get() as Row
    const code = secId.split('.')[1]
    this.db.prepare(
      'INSERT INTO watchlist (sec_id, code, name, market_type, sort_order) VALUES (?,?,?,?,?)',
    ).run(secId, code, name, market, Number(max.m) + 1)
    return this.listWatchlist().find((w) => w.secId === secId)!
  }

  removeWatchlist(secId: string): void {
    this.db.prepare('DELETE FROM watchlist WHERE sec_id = ?').run(secId)
  }

  reorderWatchlist(secIds: string[]): void {
    const tx = this.db.transaction(() => {
      const stmt = this.db.prepare('UPDATE watchlist SET sort_order = ? WHERE sec_id = ?')
      secIds.forEach((id, i) => stmt.run(i + 1, id))
    })
    tx()
  }

  /* ---------- alert rules ---------- */

  listRules(): AlertRule[] {
    const rows = this.db.prepare('SELECT * FROM alert_rules').all() as Row[]
    return rows.map((r) => ({
      id: String(r.id), scope: String(r.scope) as AlertRule['scope'],
      secId: r.sec_id ? String(r.sec_id) : undefined,
      metric: String(r.metric) as AlertRule['metric'], op: String(r.op) as AlertRule['op'],
      threshold: Number(r.threshold), cooldown: String(r.cooldown), enabled: !!r.enabled,
    }))
  }

  upsertRule(rule: AlertRule): void {
    if (rule.threshold < 0.1 || rule.threshold > 100) throw new Error('THRESHOLD_RANGE')
    if (rule.scope === 'security' && !rule.secId) throw new Error('SEC_REQUIRED')
    this.db.prepare(`
      INSERT INTO alert_rules (id, scope, sec_id, metric, op, threshold, cooldown, enabled)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        scope=excluded.scope, sec_id=excluded.sec_id, metric=excluded.metric,
        op=excluded.op, threshold=excluded.threshold, cooldown=excluded.cooldown, enabled=excluded.enabled
    `).run(
      rule.id ?? randomUUID(), rule.scope, rule.secId ?? null, rule.metric, rule.op,
      rule.threshold, rule.cooldown, rule.enabled ? 1 : 0,
    )
  }

  deleteRule(ruleId: string): void {
    this.db.prepare('DELETE FROM alert_rules WHERE id = ?').run(ruleId)
  }

  /* ---------- alert events ---------- */

  insertAlertEvent(e: Omit<AlertEvent, 'id'>): AlertEvent {
    const r = this.db.prepare(`
      INSERT INTO alert_events (sec_id, sec_name, rule_id, direction, value, message)
      VALUES (?,?,?,?,?,?)
    `).run(e.secId, e.secName, e.ruleId, e.direction, e.value, e.message)
    return { ...e, id: Number(r.lastInsertRowid) }
  }

  /** 当日是否已同向触发（防骚扰去重） */
  hasFiredToday(secId: string, direction: 'up' | 'down'): boolean {
    const r = this.db.prepare(`
      SELECT COUNT(*) AS c FROM alert_events
      WHERE sec_id = ? AND direction = ? AND date(triggered_at) = date('now','localtime')
    `).get(secId, direction) as Row
    return Number(r.c) > 0
  }

  /** 规则+标的+方向最近一次触发时间（epoch ms），用于分钟级冷却。规则 ID 变更历史也兼容。 */
  lastFiredAt(ruleId: string, secId: string, direction: 'up' | 'down'): number | null {
    const r = this.db.prepare(`
      SELECT triggered_at FROM alert_events
      WHERE rule_id = ? AND sec_id = ? AND direction = ?
      ORDER BY triggered_at DESC LIMIT 1
    `).get(ruleId, secId, direction) as Row | undefined
    if (!r) return null
    const t = Date.parse(String(r.triggered_at))
    return Number.isFinite(t) ? t : null
  }

  listAlertEvents(date?: string): AlertEvent[] {
    const d = date ?? 'now'
    const rows = this.db.prepare(
      "SELECT * FROM alert_events WHERE date(triggered_at) = date(?, 'localtime') ORDER BY id DESC LIMIT 200",
    ).all(d) as Row[]
    return rows.map((r) => ({
      id: Number(r.id), secId: String(r.sec_id), secName: String(r.sec_name), ruleId: String(r.rule_id),
      direction: String(r.direction) as 'up' | 'down', value: Number(r.value),
      message: String(r.message), triggeredAt: String(r.triggered_at),
    }))
  }

  resetCooldown(secId: string): void {
    this.db.prepare(
      "DELETE FROM alert_events WHERE sec_id = ? AND date(triggered_at) = date('now','localtime')",
    ).run(secId)
  }

  /* ---------- time alerts（定时时点提醒） ---------- */

  private mapTimeAlert(r: Row): TimeAlert {
    return {
      id: String(r.id), time: String(r.time), label: String(r.label),
      enabled: !!r.enabled, workdayOnly: !!r.workday_only,
    }
  }

  listTimeAlerts(): TimeAlert[] {
    const rows = this.db.prepare('SELECT * FROM time_alerts ORDER BY time ASC').all() as Row[]
    return rows.map((r) => this.mapTimeAlert(r))
  }

  upsertTimeAlert(a: TimeAlert): void {
    this.db.prepare(`
      INSERT INTO time_alerts (id, time, label, enabled, workday_only)
      VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        time=excluded.time, label=excluded.label,
        enabled=excluded.enabled, workday_only=excluded.workday_only
    `).run(a.id, a.time, a.label, a.enabled ? 1 : 0, a.workdayOnly ? 1 : 0)
  }

  deleteTimeAlert(id: string): void {
    this.db.prepare('DELETE FROM time_alerts WHERE id = ?').run(id)
  }

  /** 当前分钟命中且当日尚未触发的定时提醒（防止轮询在同一分钟内重复响） */
  dueTimeAlerts(hm: string, today: string): TimeAlert[] {
    const rows = this.db.prepare(`
      SELECT * FROM time_alerts
      WHERE enabled = 1 AND time = ? AND (last_fired_date IS NULL OR last_fired_date <> ?)
    `).all(hm, today) as Row[]
    return rows.map((r) => this.mapTimeAlert(r))
  }

  markTimeAlertFired(id: string, today: string): void {
    this.db.prepare('UPDATE time_alerts SET last_fired_date = ? WHERE id = ?').run(today, id)
  }

  /* ---------- closing reports ---------- */

  upsertClosingReport(r: ClosingReport): void {
    this.db.prepare(`
      INSERT INTO closing_reports (trade_date, generated_at, payload) VALUES (?,?,?)
      ON CONFLICT(trade_date) DO UPDATE SET generated_at=excluded.generated_at, payload=excluded.payload
    `).run(r.date, r.generatedAt, JSON.stringify(r))
  }

  listClosingReports(limit = 30): ClosingReport[] {
    const rows = this.db.prepare(
      'SELECT payload FROM closing_reports ORDER BY trade_date DESC LIMIT ?',
    ).all(limit) as Row[]
    const out: ClosingReport[] = []
    for (const r of rows) {
      try { out.push(JSON.parse(String(r.payload)) as ClosingReport) } catch { /* 跳过损坏数据 */ }
    }
    return out
  }

  /* ---------- settings ---------- */

  getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Row[]
    const stored: Record<string, unknown> = {}
    for (const r of rows) {
      try { stored[String(r.key)] = JSON.parse(String(r.value)) } catch { stored[String(r.key)] = String(r.value) }
    }
    return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, JSON.stringify(value))
  }
}
