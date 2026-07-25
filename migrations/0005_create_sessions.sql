-- Migration number: 0005 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - Session 表
--
-- 目的：
--   管理用户登录 Session。Token 仅存 SHA-256 哈希。
--   Token 格式：sp_sess_ + 64 hex（由 crypto.getRandomValues(32) 生成）。
--   有效期 30 天，支持多设备登录。

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,              -- UUID
    user_id     TEXT NOT NULL,                 -- FK users.id
    token_hash  TEXT NOT NULL UNIQUE,          -- SHA-256(session_token)
    expires_at  TEXT NOT NULL,                 -- ISO 8601
    last_used_at TEXT,                          -- 最近使用时间
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
