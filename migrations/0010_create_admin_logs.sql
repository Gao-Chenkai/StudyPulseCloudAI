-- Migration number: 0010 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - 管理员操作日志表
--
-- 目的：
--   记录管理员对用户、API Key、会员等数据的修改操作。
--   admin_user_id 非严格外键，可保存 users.id 或 "admin_system"。

CREATE TABLE IF NOT EXISTS admin_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id   TEXT NOT NULL,              -- users.id 或 "admin_system"（非严格外键）
    action          TEXT NOT NULL,              -- 如 'change_role', 'change_membership', 'create_api_key', 'disable_api_key', 'delete_api_key'
    target_user_id  TEXT,                       -- 被操作的用户
    details         TEXT,                        -- JSON 详细信息
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);
