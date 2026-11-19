-- 定时时点提醒：到点喊一声（9:25 看集合竞价 / 14:45 决定是否过夜 等）
CREATE TABLE IF NOT EXISTS time_alerts (
  id              TEXT PRIMARY KEY,
  time            TEXT NOT NULL,              -- 'HH:mm'
  label           TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  workday_only    INTEGER NOT NULL DEFAULT 1,
  last_fired_date TEXT                      -- 'YYYY-MM-DD'，防当日重复触发
);
CREATE INDEX IF NOT EXISTS idx_time_alerts_time ON time_alerts(time);
