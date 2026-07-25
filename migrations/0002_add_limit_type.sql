-- Migration number: 0002 	 2026-07-25T04:00:00.000Z
--
-- StudyPulse Cloud AI Beta - 额度限制方式扩展
--
-- 目的：
--   支持两种额度限制方式：按请求次数（count）或按 Token 用量（tokens）。
--   新增 limit_type 列用于选择限制方式，新增 token_count 列记录累计 Token 消耗。
--
-- 设计：
--   - limit_type: "count"（默认，向后兼容）或 "tokens"
--   - request_limit: 上限值，对两种模式通用。limit_type="count" 时对比 request_count，
--     limit_type="tokens" 时对比 token_count
--   - token_count: 累计 Token 消耗，每次成功调用后累加 total_tokens
--
-- 兼容性：现有 Key 默认 limit_type="count"，行为不变

-- ────────────────────────────────────────────────────────────────────────────
-- 新增 limit_type 列：限制方式
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE api_keys ADD COLUMN limit_type TEXT NOT NULL DEFAULT 'count';

-- ────────────────────────────────────────────────────────────────────────────
-- 新增 token_count 列：累计 Token 消耗
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE api_keys ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0;
