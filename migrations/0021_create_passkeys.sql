-- Migration number: 0021  2026-08-06T00:00:00.000Z
--
-- StudyPulse passkey credentials and one-time enrollment prompt state.

ALTER TABLE users ADD COLUMN passkey_prompt_dismissed_at TEXT;

CREATE TABLE IF NOT EXISTS user_passkeys (
    credential_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    device_type TEXT,
    backed_up INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT 'Passkey',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id
    ON user_passkeys(user_id);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_last_used_at
    ON user_passkeys(last_used_at);
