-- 持仓：自选表增加股数与成本价（0 表示未持仓 / 只观察）
ALTER TABLE watchlist ADD COLUMN shares REAL NOT NULL DEFAULT 0;
ALTER TABLE watchlist ADD COLUMN cost_price REAL NOT NULL DEFAULT 0;
