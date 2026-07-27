-- Migration number: 0011 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - 会员计划种子数据
--
-- 目的：
--   插入默认的三种会员等级配置。
--   free：每日 5 次，月 10K tokens
--   plus：每日 50 次，月 200K tokens
--   pro：每日 200 次，月 1.5M tokens

INSERT OR IGNORE INTO membership_plans (id, name, daily_request_limit, monthly_token_limit, available_models) VALUES
    ('free', 'Free', 5, 10000, '["MiniMax-M3"]'),
    ('plus', 'Plus', 50, 200000, '["MiniMax-M3"]'),
    ('pro', 'Pro', 200, 1500000, '["MiniMax-M3"]');
