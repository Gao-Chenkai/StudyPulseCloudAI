-- Migration number: 0006 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - 邮箱验证码表
--
-- 目的：
--   管理邮箱登录验证码。支持 10 分钟有效期、5 次错误尝试锁定、
--   一次性使用、Resend 发送状态追踪。

CREATE TABLE IF NOT EXISTS email_verification_codes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL,
    code            TEXT NOT NULL,                 -- 6 位数字
    used            INTEGER NOT NULL DEFAULT 0,   -- 0=未使用, 1=已使用
    attempts        INTEGER NOT NULL DEFAULT 0,   -- 验证码错误次数
    delivery_status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'sent'|'failed'
    expires_at      TEXT NOT NULL,                 -- 10 分钟有效期
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verification_email_code ON email_verification_codes(email, code);
CREATE INDEX IF NOT EXISTS idx_verification_created_at ON email_verification_codes(created_at);
