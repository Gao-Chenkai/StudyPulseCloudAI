-- Migration number: 0014  2026-07-26T00:00:00.000Z
--
-- StudyPulse Cloud AI - password authentication and auth hardening
--
-- This migration is intentionally a D1 migration, not startup schema creation.

-- 1. Canonical email lookup value. Existing users/codes are backfilled before
-- the unique index is created. The original email column is retained.
ALTER TABLE users ADD COLUMN email_normalized TEXT;
UPDATE users SET email_normalized = lower(trim(email)) WHERE email_normalized IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized
    ON users(email_normalized);

-- 2. Password credentials are one-to-one with users.
CREATE TABLE IF NOT EXISTS user_credentials (
    user_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_algorithm TEXT NOT NULL DEFAULT 'pbkdf2-sha256',
    password_iterations INTEGER NOT NULL,
    password_updated_at TEXT NOT NULL,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Rebuild the existing sessions table so the legacy rows gain revocation,
-- device metadata, and the declared user foreign key.
CREATE TABLE sessions_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    last_used_at TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    device_name TEXT,
    user_agent TEXT,
    ip_address TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO sessions_new
	(id, user_id, token_hash, expires_at, last_used_at, created_at,
	 revoked_at, device_name, user_agent, ip_address)
SELECT id, user_id, token_hash, expires_at, last_used_at, created_at,
	   NULL, NULL, NULL, NULL
  FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

-- 4. Make verification records purpose-aware and canonical-email-aware.
ALTER TABLE email_verification_codes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login';
ALTER TABLE email_verification_codes ADD COLUMN email_normalized TEXT;
UPDATE email_verification_codes
   SET email_normalized = lower(trim(email))
 WHERE email_normalized IS NULL;
CREATE INDEX IF NOT EXISTS idx_verification_email_purpose_created
    ON email_verification_codes(email_normalized, purpose, created_at);
CREATE INDEX IF NOT EXISTS idx_verification_purpose
    ON email_verification_codes(purpose);

-- 5. D1-backed login throttling. key_hash is SHA-256 of a purpose-scoped
-- identifier and raw IP addresses and email addresses are not stored here
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key_hash TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    window_started_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    blocked_until TEXT,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated_at
    ON auth_rate_limits(updated_at);
