-- 收盘总结报告（P2）：每个交易日一条，JSON 存储完整报告内容
CREATE TABLE IF NOT EXISTS closing_reports (
  trade_date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_closing_reports_date ON closing_reports(trade_date DESC);
