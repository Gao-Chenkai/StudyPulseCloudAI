-- Migration number: 0013 	 2026-07-26T00:00:00.000Z
--
-- StudyPulse Cloud AI - 使 request_logs.api_key_id 可为 NULL
--
-- 背景：
--   0002 初始建表时 api_key_id 为 NOT NULL，但 0008 新增 user_id
--   并设计了 Session Token 场景（api_key_id=NULL, user_id 有值），
--   遗漏了移除 NOT NULL 约束。导致 Session 用户调用时写入日志报：
--   D1_ERROR: NOT NULL constraint failed: request_logs.api_key_id
--
-- SQLite 不支持 ALTER COLUMN 改约束，需要重建表。

-- 1. 创建新表（api_key_id 可为 NULL，移除外键约束避免级联问题）
CREATE TABLE IF NOT EXISTS request_logs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id INTEGER,
    user_id TEXT,
    request_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    model TEXT,
    provider TEXT,
    status INTEGER NOT NULL,
    latency_ms INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    ip TEXT,
    user_agent TEXT,
    error_message TEXT
);

-- 2. 复制现有数据
INSERT INTO request_logs_new
    (id, api_key_id, user_id, request_time, model, provider,
     status, latency_ms, prompt_tokens, completion_tokens, total_tokens,
     ip, user_agent, error_message)
SELECT id, api_key_id, user_id, request_time, model, provider,
       status, latency_ms, prompt_tokens, completion_tokens, total_tokens,
       ip, user_agent, error_message
FROM request_logs;

-- 3. 删除旧表
DROP TABLE request_logs;

-- 4. 重命名新表
ALTER TABLE request_logs_new RENAME TO request_logs;

-- 5. 重建索引
CREATE INDEX IF NOT EXISTS idx_request_logs_api_key_id
    ON request_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_request_time
    ON request_logs(request_time);
CREATE INDEX IF NOT EXISTS idx_request_logs_status
    ON request_logs(status);
CREATE INDEX IF NOT EXISTS idx_request_logs_user_id
    ON request_logs(user_id);
