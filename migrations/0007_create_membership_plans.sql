-- Migration number: 0007 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - 会员计划表
--
-- 目的：
--   定义不同会员等级的额度限制和可用模型。
--   额度配置不写死在代码中，管理员可通过数据库修改。
--   种子数据在 0011 中插入。

CREATE TABLE IF NOT EXISTS membership_plans (
    id                  TEXT PRIMARY KEY,      -- 'free' | 'plus' | 'pro'
    name                TEXT NOT NULL,
    daily_request_limit INTEGER,              -- NULL = 不限
    monthly_token_limit INTEGER,              -- NULL = 不限
    available_models    TEXT NOT NULL DEFAULT '["MiniMax-M3"]'  -- JSON array
);
