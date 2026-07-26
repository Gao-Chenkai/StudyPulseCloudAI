-- StudyPulse Cloud AI - user feedback tickets
CREATE TABLE IF NOT EXISTS feedback_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'top')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed')),
    admin_reply TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feedback_pending_order
    ON feedback_tickets(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_user_created
    ON feedback_tickets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_processed_created
    ON feedback_tickets(status, processed_at DESC);
