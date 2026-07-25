-- Migration number: 0012 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - 邮箱黑名单表
--
-- 目的：
--   存储被拉黑的邮箱地址，阻止其注册/登录。
--   管理员可以添加、删除、查询黑名单。

CREATE TABLE IF NOT EXISTS blacklisted_emails (
    email       TEXT PRIMARY KEY,               -- 邮箱地址（小写）
    reason      TEXT,                           -- 拉黑原因（可选）
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
