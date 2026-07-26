-- Migration number: 0012 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - 已封禁邮箱表（历史表名保持不变）
--
-- 目的：
--   存储被封禁的邮箱地址，阻止其注册/登录。
--   管理员可以封禁、解除封禁、查询用户。

CREATE TABLE IF NOT EXISTS blacklisted_emails (
    email       TEXT PRIMARY KEY,               -- 邮箱地址（小写）
    reason      TEXT,                           -- 封禁原因（可选）
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
