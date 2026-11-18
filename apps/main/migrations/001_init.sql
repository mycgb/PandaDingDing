-- PandaDingDing 001 初始结构
CREATE TABLE IF NOT EXISTS watchlist (
  sec_id      TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  market_type INTEGER NOT NULL,
  weight      REAL DEFAULT 1.0,
  sort_order  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL CHECK (scope IN ('global','security')),
  sec_id     TEXT REFERENCES watchlist(sec_id) ON DELETE CASCADE,
  metric     TEXT NOT NULL,
  op         TEXT NOT NULL CHECK (op IN ('above','below','absAbove')),
  threshold  REAL NOT NULL,
  cooldown   TEXT NOT NULL DEFAULT 'oncePerDay',
  enabled    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alert_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sec_id     TEXT NOT NULL,
  sec_name   TEXT NOT NULL,
  rule_id    TEXT NOT NULL,
  direction  TEXT NOT NULL CHECK (direction IN ('up','down')),
  value      REAL NOT NULL,
  message    TEXT NOT NULL,
  triggered_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_alert_events_day
  ON alert_events(sec_id, direction, date(triggered_at));

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
