"""SQLite database schema and initialization for local storage.

Single-writer pattern owned by FastAPI with WAL mode enabled.
All tables enforce tenant_id as a NOT NULL column and all timestamps
are stored as ISO-8601 UTC strings.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent.parent / ".helm" / "helm.sqlite"

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS workspace_threads (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    tag TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workspace_messages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    citations_json TEXT,
    model TEXT NOT NULL,
    grounded INTEGER NOT NULL DEFAULT 1,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    ts TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES workspace_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_steps (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    hop_index INTEGER NOT NULL,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    hop_kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    governor_rationale TEXT NOT NULL,
    verdict TEXT NOT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_micros INTEGER NOT NULL DEFAULT 0,
    ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    meta_json TEXT,
    ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_tenant_updated ON workspace_threads (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_tenant_pinned ON workspace_threads (tenant_id, is_pinned, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_ts ON workspace_messages (tenant_id, thread_id, ts ASC);
CREATE INDEX IF NOT EXISTS idx_steps_run_hop ON agent_steps (tenant_id, run_id, hop_index ASC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_ts ON audit_log (tenant_id, ts DESC);
"""


def get_db_path() -> Path:
    env_path = os.getenv("HELM_SQLITE_PATH")
    if env_path:
        path = Path(env_path)
    else:
        path = DEFAULT_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def open_db() -> sqlite3.Connection:
    path = get_db_path()
    conn = sqlite3.connect(str(path), timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_sqlite_db() -> None:
    """Run migrations and ensure tables/indexes exist."""
    conn = open_db()
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
    finally:
        conn.close()
