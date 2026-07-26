-- StudyPulse unified identity: OAuth accounts and refresh-token sessions.

ALTER TABLE users ADD COLUMN password_hash TEXT;

CREATE TABLE IF NOT EXISTS user_oauth_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_email TEXT,
    username TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_oauth_user_id ON user_oauth_accounts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_oauth_provider_email
    ON user_oauth_accounts(provider, provider_email);

ALTER TABLE sessions ADD COLUMN refresh_token_hash TEXT;
ALTER TABLE sessions ADD COLUMN refresh_expires_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash
    ON sessions(refresh_token_hash);
