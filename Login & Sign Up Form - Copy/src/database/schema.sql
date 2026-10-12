-- ==============================================================================
-- SECURE AUTHENTICATION & ACCESS MANAGEMENT SYSTEM (SAAMS)
-- DATABASE SCHEMA MIGRATION SCRIPT (SQLITE & POSTGRESQL COMPATIBLE)
-- ==============================================================================

-- 1. Users & Identity Governance
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('inputer', 'admin', 'administrator', 'manager')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'locked', 'pending_verification')),
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    last_login_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. Two-Factor Authentication (Encrypted TOTP Secrets)
CREATE TABLE IF NOT EXISTS two_factor_auth (
    user_id TEXT PRIMARY KEY,
    encrypted_totp_secret TEXT NOT NULL,
    secret_iv TEXT NOT NULL,
    secret_tag TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 0,
    enrolled_at TEXT DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Single-Use Emergency Recovery Codes
CREATE TABLE IF NOT EXISTS recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    used_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);

-- 4. Session State Management
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    is_2fa_verified INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 5. Operational Business Records
CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'approved', 'rejected')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_records_created_by ON records(created_by);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);

-- 6. Tamper-Evident Security Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    actor_id TEXT,
    actor_username TEXT,
    actor_role TEXT,
    event_type TEXT NOT NULL,
    target_id TEXT,
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,
    ip_address TEXT,
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);

-- 7. Disaster Recovery & Backup Audit Registry
CREATE TABLE IF NOT EXISTS backup_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    file_name TEXT,
    sha256_digest TEXT,
    size_bytes INTEGER,
    storage_destination TEXT,
    error_message TEXT,
    is_drill_verified INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_backups_started ON backup_logs(started_at);
