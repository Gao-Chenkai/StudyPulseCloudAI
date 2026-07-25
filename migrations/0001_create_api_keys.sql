-- Migration number: 0001 	 2026-07-25T03:36:05.235Z
--
-- StudyPulse Cloud AI Beta - 第一个 D1 migration
--
-- 目的：
--   建立 API Key 持久化表，替换 src/auth.js 中的内存 Set（sp_beta_test001）。
--   设计目标：
--     1. 仅存哈希，绝不存原始 Key（防泄露）
--     2. 支持启用/停用、用量统计、额度限制、过期时间
--     3. 字段足够 Beta 期使用，但不为未来未知需求过度设计
--
-- 绑定：StudyPulseDB（D1）
-- 命名约定：snake_case；时间字段统一 TEXT（D1 推荐存储 ISO 8601 字符串）

-- ────────────────────────────────────────────────────────────────────────────
-- api_keys 表：客户端访问 Worker 用的 API Key
-- ────────────────────────────────────────────────────────────────────────────
-- 命名说明：key_hash 而非 key，是为了在代码 review、日志、备份中
--           一眼看出「这里不是原始 Key」，降低误用与误打印风险。
CREATE TABLE IF NOT EXISTS api_keys (
    -- 自增主键。D1（SQLite）的 rowid 别名，无需手动赋值
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- API Key 的 SHA-256 hex 摘要。
    -- 输入：原始 Key 字符串，如 "sp_beta_test001"
    -- 存储：64 个 hex 字符，无盐、无 pepper（Key 本身已是高熵随机串）
    -- UNIQUE：保证两条记录不会指向同一个 Key
    -- 鉴权时：WHERE key_hash = sha256(request.header.Authorization)
    key_hash TEXT NOT NULL UNIQUE,

    -- 人类可读的 Key 名称，用于管理后台展示。例如 "iOS Beta 内测 1"
    -- 不参与鉴权，仅用于识别 Key 的用途与归属
    name TEXT NOT NULL,

    -- 启用状态：1 = 可用，0 = 已停用。
    -- 用 INTEGER 而非 BOOLEAN（D1/SQLite 无原生布尔类型）
    -- 鉴权时：WHERE enabled = 1
    -- 默认 1：新建即生效
    enabled INTEGER NOT NULL DEFAULT 1,

    -- 累计请求次数。每次鉴权通过 +1。
    -- 用于用量观测与未来按量计费。无上限约束，超出 request_limit 时
    -- 由应用层判断（不在 SQL 层 CHECK，以便调整策略无需改 schema）
    request_count INTEGER NOT NULL DEFAULT 0,

    -- 请求额度上限。NULL = 不限量；非 NULL = 累计上限。
    -- 与 request_count 配合实现软额度控制。
    -- 设计为可空：Beta 阶段多数 Key 不限量，留 NULL 比写 0 更语义清晰
    request_limit INTEGER,

    -- 用户/账号标识。当前 Beta 期可留空（iOS 还没账号系统）。
    -- 未来接入 StudyPulse 账号后，关联到 users 表的 user_id。
    -- 用 TEXT 而非 INTEGER：兼容未来用 UUID / ULID 作 user_id 的方案
    user_id TEXT,

    -- 备注信息，自由文本。例如发放渠道、有效期说明、回收原因等
    notes TEXT,

    -- 过期时间，ISO 8601 字符串（如 "2026-12-31T23:59:59Z"）。
    -- NULL = 永不过期。鉴权时由应用层判断，避免每次鉴权都做 SQL 时间运算
    expires_at TEXT,

    -- 创建时间。D1 默认 CURRENT_TIMESTAMP 返回 UTC ISO 8601 字符串
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 最后一次使用时间。鉴权通过时 UPDATE。
    -- NULL = 从未使用过。用于清理长期未活跃 Key、运营分析
    last_used_at TEXT
);

-- ────────────────────────────────────────────────────────────────────────────
-- 索引
-- ────────────────────────────────────────────────────────────────────────────
-- 鉴权热路径：每次 /v1/chat 都按 key_hash 单点查询。
-- 虽然 key_hash 已是 UNIQUE（SQLite 自动建索引），但显式建一个
-- 命名索引让 migration 意图更清晰，也方便未来 EXPLAIN QUERY PLAN 调试
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash
    ON api_keys(key_hash);

-- 管理后台常见的「列出所有启用/停用 Key」查询
-- enabled 取值只有 0/1，区分度低，索引选择性差；
-- 但Beta期数据量小（<100 行），加索引的成本可忽略，预留扩展
CREATE INDEX IF NOT EXISTS idx_api_keys_enabled
    ON api_keys(enabled);
