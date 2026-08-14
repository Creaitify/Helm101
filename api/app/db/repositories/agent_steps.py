"""Data access layer for persistent agent relay steps and hop envelopes.

All steps are tenant-scoped, indexed by run_id and hop_index, and written with audit records.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.db.sqlite_schema import open_db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AgentStepsRepository:
    def record_step(
        self,
        tenant_id: str,
        run_id: str,
        hop_index: int,
        from_agent: str,
        to_agent: str,
        hop_kind: str,
        payload: dict[str, Any],
        governor_rationale: str,
        verdict: str,
        tokens_in: int = 0,
        tokens_out: int = 0,
        cost_micros: int = 0,
    ) -> dict[str, Any]:
        """Record an agent handoff envelope to agent_steps and audit_log."""
        conn = open_db()
        try:
            step_id = str(uuid4())
            now = _now_iso()
            payload_json = json.dumps(payload)

            conn.execute(
                """
                INSERT INTO agent_steps (
                    id, tenant_id, run_id, hop_index, from_agent, to_agent,
                    hop_kind, payload_json, governor_rationale, verdict,
                    tokens_in, tokens_out, cost_micros, ts
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    step_id,
                    tenant_id,
                    run_id,
                    hop_index,
                    from_agent,
                    to_agent,
                    hop_kind,
                    payload_json,
                    governor_rationale,
                    verdict,
                    tokens_in,
                    tokens_out,
                    cost_micros,
                    now,
                ),
            )

            conn.execute(
                """
                INSERT INTO audit_log (id, tenant_id, actor_type, actor_id, action, target, meta_json, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    tenant_id,
                    "agent",
                    f"agent:{from_agent}",
                    "agent.step.emitted",
                    f"run:{run_id}:hop:{hop_index}",
                    json.dumps(
                        {
                            "to_agent": to_agent,
                            "hop_kind": hop_kind,
                            "verdict": verdict,
                            "cost_micros": cost_micros,
                        }
                    ),
                    now,
                ),
            )
            conn.commit()

            return {
                "id": step_id,
                "tenant_id": tenant_id,
                "run_id": run_id,
                "hop_index": hop_index,
                "from_agent": from_agent,
                "to_agent": to_agent,
                "hop_kind": hop_kind,
                "payload": payload,
                "governor_rationale": governor_rationale,
                "verdict": verdict,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "cost_micros": cost_micros,
                "ts": now,
            }
        finally:
            conn.close()

    def list_steps(self, tenant_id: str, run_id: str) -> list[dict[str, Any]]:
        """List all hop envelopes for a given run in chronological hop order."""
        conn = open_db()
        try:
            cursor = conn.execute(
                """
                SELECT id, tenant_id, run_id, hop_index, from_agent, to_agent,
                       hop_kind, payload_json, governor_rationale, verdict,
                       tokens_in, tokens_out, cost_micros, ts
                FROM agent_steps
                WHERE tenant_id = ? AND run_id = ?
                ORDER BY hop_index ASC, ts ASC
                """,
                (tenant_id, run_id),
            )
            steps = []
            for row in cursor.fetchall():
                payload = {}
                if row["payload_json"]:
                    try:
                        payload = json.loads(row["payload_json"])
                    except Exception:
                        payload = {}

                steps.append(
                    {
                        "id": row["id"],
                        "tenant_id": row["tenant_id"],
                        "run_id": row["run_id"],
                        "hop_index": row["hop_index"],
                        "from_agent": row["from_agent"],
                        "to_agent": row["to_agent"],
                        "hop_kind": row["hop_kind"],
                        "payload": payload,
                        "governor_rationale": row["governor_rationale"],
                        "verdict": row["verdict"],
                        "tokens_in": row["tokens_in"],
                        "tokens_out": row["tokens_out"],
                        "cost_micros": row["cost_micros"],
                        "ts": row["ts"],
                    }
                )
            return steps
        finally:
            conn.close()
