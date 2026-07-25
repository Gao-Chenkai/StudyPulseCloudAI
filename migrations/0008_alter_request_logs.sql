-- Migration number: 0008 	 2026-07-25T00:00:00.000Z
--
-- StudyPulse Cloud AI - request_logs 增加 user_id 列
--
-- 目的：
--   支持 Session 用户和绑定用户的 API Key 调用日志关联 user_id。
--   三种记录情况：
--     - Session Token：user_id 有值, api_key_id=NULL
--     - API Key 绑定用户：user_id 有值, api_key_id 有值
--     - 旧 API Key：user_id=NULL, api_key_id 有值

ALTER TABLE request_logs ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_request_logs_user_id ON request_logs(user_id);
