-- Code contribution review workflow.
CREATE TABLE IF NOT EXISTS contribution_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    contribution_url TEXT NOT NULL,
    contribution_type TEXT NOT NULL DEFAULT 'other' CHECK (contribution_type IN ('fork', 'issue', 'pull_request', 'other')),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    awarded_membership TEXT CHECK (awarded_membership IN ('plus', 'pro')),
    membership_expires_at TEXT,
    admin_reply TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contribution_status_created
    ON contribution_tickets(status, created_at);
CREATE INDEX IF NOT EXISTS idx_contribution_user_created
    ON contribution_tickets(user_id, created_at DESC);
