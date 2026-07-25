-- Migration number: 0011 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - 会员计划种子数据
--
-- 目的：
--   插入默认的三种会员等级配置。
--   free：每日 50 次，月 100K tokens
--   plus：每日 500 次，月 1M tokens
--   pro：不限量

INSERT OR IGNORE INTO membership_plans (id, name, daily_request_limit, monthly_token_limit, available_models) VALUES
    ('free', 'Free', 50, 100000, '["MiniMax-M3"]'),
    ('plus', 'Plus', 500, 1000000, '["MiniMax-M3"]'),
    ('pro', 'Pro', NULL, NULL, '["MiniMax-M3"]');
