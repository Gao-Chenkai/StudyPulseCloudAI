-- Migration number: 0004 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - 用户表
--
-- 目的：
--   建立正式用户体系，支持邮箱注册、角色管理、会员等级。
--   所有邮箱写入前必须 trim().toLowerCase()。
--   github_id 仅为预留字段，本阶段不实现 GitHub OAuth。

CREATE TABLE IF NOT EXISTS users (
    id                  TEXT PRIMARY KEY,              -- UUID
    email               TEXT UNIQUE NOT NULL,
    email_verified      INTEGER NOT NULL DEFAULT 0,    -- 0=未验证, 1=已验证
    role                TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
    membership_type     TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'plus' | 'pro'
    membership_expires_at TEXT,                         -- NULL=未设置到期时间；free 忽略；plus/pro 过期降级
    github_id           TEXT UNIQUE,                   -- 预留，本阶段不实现
    username            TEXT,
    avatar_url          TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
