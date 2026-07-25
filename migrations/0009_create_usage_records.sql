-- Migration number: 0009 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - 用量记录表
--
-- 目的：
--   按 user_id 记录每次 AI 调用的 Token 消耗。
--   用于会员额度检查（每日请求数、每月 Token 消耗）。
--   三种记录情况：
--     - Session Token：user_id 有值, api_key_id=NULL
--     - API Key 绑定用户：user_id 有值, api_key_id 有值
--     - 旧 API Key（不写此表）
--   Token 字段默认 0，避免流式请求无 usage 时 SUM() 返回 NULL。

CREATE TABLE IF NOT EXISTS usage_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT,                       -- FK users.id
    api_key_id      INTEGER,                    -- 通过 API Key 调用时记录
    model           TEXT,
    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    total_tokens    INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_id ON usage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_created_at ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_records_user_created ON usage_records(user_id, created_at);
