-- Migration number: 0002 	 2026-07-25T12:00:00.000Z
--
-- StudyPulse Cloud AI - 请求日志表
--
-- 目的：
--   记录每次 AI 请求的元数据（不存 prompt/reply 内容），
--   供管理后台查看用量统计与排查问题。
--
-- 设计原则：
--   1. 不记录 prompt、reply 文本 —— 保护用户隐私
--   2. 外键关联 api_keys，方便按 Key 聚合统计
--   3. 状态字段支持按成功/失败筛选日志
--   4. 预留 token 用量字段，用于成本核算

CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- 关联的 API Key ID，外键引用 api_keys(id)
    -- ON DELETE CASCADE：删除 Key 时自动清理关联日志
    api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,

    -- 请求时间，UTC ISO 8601
    request_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 模型名，如 MiniMax-M3
    model TEXT,

    -- Provider 名，如 minimax
    provider TEXT,

    -- HTTP 状态码（200=成功，502=上游失败等）
    status INTEGER NOT NULL,

    -- 请求延迟（毫秒）
    latency_ms INTEGER,

    -- Token 用量（由上游 API 返回，预留字段）
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,

    -- 客户端信息（不记录原始 IP 时可留空）
    ip TEXT,
    user_agent TEXT,

    -- 错误信息（仅失败时填写，截断至 500 字符防膨胀）
    error_message TEXT
);

-- 按 api_key_id 查询某 Key 的所有日志
CREATE INDEX IF NOT EXISTS idx_request_logs_api_key_id
    ON request_logs(api_key_id);

-- 按时间倒序查询最近日志
CREATE INDEX IF NOT EXISTS idx_request_logs_request_time
    ON request_logs(request_time);

-- 按状态筛选（成功/失败）
CREATE INDEX IF NOT EXISTS idx_request_logs_status
    ON request_logs(status);
