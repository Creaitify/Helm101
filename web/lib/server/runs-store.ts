/**
 * Unified Runs Store — SQLite-backed persistence for agent runs.
 *
 * Replaces the JSON file approach (live-approvals.json, governor-variants.json)
 * with a durable SQLite database. Falls back gracefully to an in-memory Map
 * if better-sqlite3 is unavailable (e.g. during builds).
 *
 * Schema:
 *   agent_runs(run_id TEXT PK, agent TEXT, objective TEXT, status TEXT,
 *              state_json TEXT, created_at TEXT, updated_at TEXT)
 */

import path from 'path'
import fs from 'fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredRun {
  runId: string
  agent: string
  objective: string
  status: string
  stateJson: string
  createdAt: string
  updatedAt: string
}

export interface RunSummary {
  runId: string
  agent: string
  objective: string
  status: string
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// SQLite initialisation (lazy, process-wide singleton)
// ---------------------------------------------------------------------------

let _db: any = null
let _memoryFallback: Map<string, StoredRun> | null = null

const DB_DIR = path.resolve(process.cwd(), 'data')
const DB_PATH = path.join(DB_DIR, 'helm-runs.sqlite')

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id     TEXT PRIMARY KEY,
  agent      TEXT NOT NULL DEFAULT 'governor',
  objective  TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'running',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent);
CREATE INDEX IF NOT EXISTS idx_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_updated ON agent_runs(updated_at DESC);
`

function getDb(): any {
  if (_db) return _db
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    fs.mkdirSync(DB_DIR, { recursive: true })
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('busy_timeout = 3000')
    _db.exec(CREATE_TABLE)
    return _db
  } catch {
    // better-sqlite3 not available — use in-memory Map
    _memoryFallback = _memoryFallback || new Map()
    return null
  }
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/** Persist or update an agent run. */
export function saveRun(
  runId: string,
  agent: string,
  objective: string,
  status: string,
  state: Record<string, any>,
): void {
  const now = new Date().toISOString()
  const stateJson = JSON.stringify(state)
  const db = getDb()

  if (db) {
    const stmt = db.prepare(`
      INSERT INTO agent_runs (run_id, agent, objective, status, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        status     = excluded.status,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `)
    stmt.run(runId, agent, objective, status, stateJson, now, now)
  } else if (_memoryFallback) {
    const existing = _memoryFallback.get(runId)
    _memoryFallback.set(runId, {
      runId,
      agent,
      objective,
      status,
      stateJson,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    })
  }
}

/** Retrieve a single run by ID. */
export function getRun(runId: string): StoredRun | null {
  const db = getDb()

  if (db) {
    const row = db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId) as any
    if (!row) return null
    return {
      runId: row.run_id,
      agent: row.agent,
      objective: row.objective,
      status: row.status,
      stateJson: row.state_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  return _memoryFallback?.get(runId) || null
}

/** List recent runs, newest first. */
export function listRuns(limit = 50): RunSummary[] {
  const db = getDb()

  if (db) {
    const rows = db
      .prepare('SELECT run_id, agent, objective, status, created_at, updated_at FROM agent_runs ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as any[]
    return rows.map((r: any) => ({
      runId: r.run_id,
      agent: r.agent,
      objective: r.objective,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  if (_memoryFallback) {
    return Array.from(_memoryFallback.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(({ stateJson: _, ...rest }) => rest)
  }

  return []
}

/** List runs filtered by agent type. */
export function listRunsByAgent(agent: string, limit = 20): RunSummary[] {
  const db = getDb()

  if (db) {
    const rows = db
      .prepare('SELECT run_id, agent, objective, status, created_at, updated_at FROM agent_runs WHERE agent = ? ORDER BY updated_at DESC LIMIT ?')
      .all(agent, limit) as any[]
    return rows.map((r: any) => ({
      runId: r.run_id,
      agent: r.agent,
      objective: r.objective,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  if (_memoryFallback) {
    return Array.from(_memoryFallback.values())
      .filter((r) => r.agent === agent)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(({ stateJson: _, ...rest }) => rest)
  }

  return []
}

/** List runs awaiting human approval. */
export function listPendingRuns(): StoredRun[] {
  const db = getDb()

  if (db) {
    const rows = db
      .prepare("SELECT * FROM agent_runs WHERE status = 'awaiting_approval' ORDER BY updated_at DESC")
      .all() as any[]
    return rows.map((r: any) => ({
      runId: r.run_id,
      agent: r.agent,
      objective: r.objective,
      status: r.status,
      stateJson: r.state_json,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  if (_memoryFallback) {
    return Array.from(_memoryFallback.values()).filter((r) => r.status === 'awaiting_approval')
  }

  return []
}

/** Get the latest approved budget shifts (from Media Buyer or Governor runs). */
export function getLatestShifts(limit = 5): Array<{ runId: string; shifts: any[]; updatedAt: string }> {
  const db = getDb()
  const results: Array<{ runId: string; shifts: any[]; updatedAt: string }> = []

  if (db) {
    const rows = db
      .prepare(
        `SELECT run_id, state_json, updated_at FROM agent_runs
         WHERE (agent = 'governor' OR agent = 'media_buyer')
           AND status IN ('completed', 'awaiting_approval')
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit) as any[]
    for (const row of rows) {
      try {
        const state = JSON.parse(row.state_json)
        const shifts = state.shifts || state.budget_proposal?.shifts || []
        if (shifts.length > 0) {
          results.push({ runId: row.run_id, shifts, updatedAt: row.updated_at })
        }
      } catch { /* ignore parse errors */ }
    }
  } else if (_memoryFallback) {
    const candidates = Array.from(_memoryFallback.values())
      .filter((r) => (r.agent === 'governor' || r.agent === 'media_buyer') && (r.status === 'completed' || r.status === 'awaiting_approval'))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
    for (const r of candidates) {
      try {
        const state = JSON.parse(r.stateJson)
        const shifts = state.shifts || state.budget_proposal?.shifts || []
        if (shifts.length > 0) {
          results.push({ runId: r.runId, shifts, updatedAt: r.updatedAt })
        }
      } catch { /* ignore */ }
    }
  }

  return results
}

/** Get the latest creative variants (from Creative or Governor runs). */
export function getLatestVariants(limit = 5): Array<{ runId: string; variants: any[]; verdicts: any[]; updatedAt: string }> {
  const db = getDb()
  const results: Array<{ runId: string; variants: any[]; verdicts: any[]; updatedAt: string }> = []

  if (db) {
    const rows = db
      .prepare(
        `SELECT run_id, state_json, updated_at FROM agent_runs
         WHERE (agent = 'governor' OR agent = 'creative')
           AND status IN ('completed', 'awaiting_approval')
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit) as any[]
    for (const row of rows) {
      try {
        const state = JSON.parse(row.state_json)
        const variants = state.variants || state.creative_deck?.variants || []
        const verdicts = state.verdicts || state.creative_deck?.verdicts || []
        if (variants.length > 0) {
          results.push({ runId: row.run_id, variants, verdicts, updatedAt: row.updated_at })
        }
      } catch { /* ignore parse errors */ }
    }
  } else if (_memoryFallback) {
    const candidates = Array.from(_memoryFallback.values())
      .filter((r) => (r.agent === 'governor' || r.agent === 'creative') && (r.status === 'completed' || r.status === 'awaiting_approval'))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
    for (const r of candidates) {
      try {
        const state = JSON.parse(r.stateJson)
        const variants = state.variants || state.creative_deck?.variants || []
        const verdicts = state.verdicts || state.creative_deck?.verdicts || []
        if (variants.length > 0) {
          results.push({ runId: r.runId, variants, verdicts, updatedAt: r.updatedAt })
        }
      } catch { /* ignore */ }
    }
  }

  return results
}

/** Get recent agent activity summaries for the analytics feed. */
export function getRecentActivity(limit = 10): Array<{
  runId: string
  agent: string
  status: string
  summary: string
  updatedAt: string
}> {
  const db = getDb()
  const results: Array<{ runId: string; agent: string; status: string; summary: string; updatedAt: string }> = []

  const source = db
    ? (db
        .prepare('SELECT run_id, agent, status, state_json, updated_at FROM agent_runs ORDER BY updated_at DESC LIMIT ?')
        .all(limit) as any[])
    : _memoryFallback
      ? Array.from(_memoryFallback.values())
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, limit)
          .map((r) => ({ run_id: r.runId, agent: r.agent, status: r.status, state_json: r.stateJson, updated_at: r.updatedAt }))
      : []

  for (const row of source) {
    try {
      const state = JSON.parse(row.state_json || row.stateJson || '{}')
      const summary =
        state.proposal?.summary ||
        state.plan?.plan_summary ||
        state.analysis ||
        state.answer?.slice(0, 120) ||
        `${row.agent} run ${row.status}`
      results.push({
        runId: row.run_id || row.runId,
        agent: row.agent,
        status: row.status,
        summary: typeof summary === 'string' ? summary.slice(0, 200) : String(summary).slice(0, 200),
        updatedAt: row.updated_at || row.updatedAt,
      })
    } catch {
      results.push({
        runId: row.run_id || row.runId,
        agent: row.agent,
        status: row.status,
        summary: `${row.agent} run ${row.status}`,
        updatedAt: row.updated_at || row.updatedAt,
      })
    }
  }

  return results
}
