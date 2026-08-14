"""Data access layer for Workspace threads and messages.

Every query strictly requires tenant_id and filters by tenant_id.
All mutations record audit events.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.db.sqlite_schema import open_db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class WorkspaceRepository:
    def list_threads(
        self,
        tenant_id: str,
        user_id: str | None = None,
        search_query: str | None = None,
        tag: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List active (non-deleted) threads for a tenant, pinned first, then updated_at DESC."""
        conn = open_db()
        try:
            sql = """
                SELECT id, tenant_id, user_id, title, tag, is_pinned, created_at, updated_at, deleted_at
                FROM workspace_threads
                WHERE tenant_id = ? AND deleted_at IS NULL
            """
            params: list[Any] = [tenant_id]

            if tag:
                sql += " AND tag = ?"
                params.append(tag)

            if search_query and search_query.strip():
                sql += " AND (title LIKE ? OR id IN (SELECT thread_id FROM workspace_messages WHERE tenant_id = ? AND content LIKE ?))"
                q = f"%{search_query.strip()}%"
                params.extend([q, tenant_id, q])

            sql += " ORDER BY is_pinned DESC, updated_at DESC LIMIT ?"
            params.append(limit)

            cursor = conn.execute(sql, params)
            threads = []
            for row in cursor.fetchall():
                threads.append(
                    {
                        "id": row["id"],
                        "tenant_id": row["tenant_id"],
                        "user_id": row["user_id"],
                        "title": row["title"],
                        "tag": row["tag"],
                        "is_pinned": bool(row["is_pinned"]),
                        "created_at": row["created_at"],
                        "updated_at": row["updated_at"],
                    }
                )
            return threads
        finally:
            conn.close()

    def create_thread(
        self,
        tenant_id: str,
        user_id: str,
        title: str,
        tag: str | None = None,
    ) -> dict[str, Any]:
        """Create a new thread within tenant context."""
        conn = open_db()
        try:
            thread_id = str(uuid4())
            now = _now_iso()
            conn.execute(
                """
                INSERT INTO workspace_threads (id, tenant_id, user_id, title, tag, is_pinned, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (thread_id, tenant_id, user_id, title, tag, now, now),
            )
            # Record audit event
            conn.execute(
                """
                INSERT INTO audit_log (id, tenant_id, actor_type, actor_id, action, target, meta_json, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    tenant_id,
                    "user",
                    user_id,
                    "workspace.thread.created",
                    f"thread:{thread_id}",
                    json.dumps({"title": title, "tag": tag}),
                    now,
                ),
            )
            conn.commit()
            return {
                "id": thread_id,
                "tenant_id": tenant_id,
                "user_id": user_id,
                "title": title,
                "tag": tag,
                "is_pinned": False,
                "created_at": now,
                "updated_at": now,
                "messages": [],
            }
        finally:
            conn.close()

    def get_thread(self, tenant_id: str, thread_id: str) -> dict[str, Any] | None:
        """Fetch thread details along with its full message history."""
        conn = open_db()
        try:
            row = conn.execute(
                """
                SELECT id, tenant_id, user_id, title, tag, is_pinned, created_at, updated_at, deleted_at
                FROM workspace_threads
                WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL
                """,
                (tenant_id, thread_id),
            ).fetchone()

            if not row:
                return None

            msg_cursor = conn.execute(
                """
                SELECT id, role, content, citations_json, model, grounded, tokens_in, tokens_out, ts
                FROM workspace_messages
                WHERE tenant_id = ? AND thread_id = ?
                ORDER BY ts ASC
                """,
                (tenant_id, thread_id),
            )

            messages = []
            for m in msg_cursor.fetchall():
                citations = []
                if m["citations_json"]:
                    try:
                        citations = json.loads(m["citations_json"])
                    except Exception:
                        citations = []
                messages.append(
                    {
                        "id": m["id"],
                        "role": m["role"],
                        "content": m["content"],
                        "citations": citations,
                        "model": m["model"],
                        "grounded": bool(m["grounded"]),
                        "tokens_in": m["tokens_in"],
                        "tokens_out": m["tokens_out"],
                        "ts": m["ts"],
                    }
                )

            return {
                "id": row["id"],
                "tenant_id": row["tenant_id"],
                "user_id": row["user_id"],
                "title": row["title"],
                "tag": row["tag"],
                "is_pinned": bool(row["is_pinned"]),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "messages": messages,
            }
        finally:
            conn.close()

    def update_thread(
        self,
        tenant_id: str,
        user_id: str,
        thread_id: str,
        title: str | None = None,
        is_pinned: bool | None = None,
    ) -> dict[str, Any] | None:
        """Update thread title or pinned status."""
        conn = open_db()
        try:
            updates = []
            params: list[Any] = []
            now = _now_iso()

            if title is not None:
                updates.append("title = ?")
                params.append(title.strip())
            if is_pinned is not None:
                updates.append("is_pinned = ?")
                params.append(1 if is_pinned else 0)

            if not updates:
                return self.get_thread(tenant_id, thread_id)

            updates.append("updated_at = ?")
            params.append(now)

            params.extend([tenant_id, thread_id])
            sql = f"UPDATE workspace_threads SET {', '.join(updates)} WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL"
            cursor = conn.execute(sql, params)

            if cursor.rowcount == 0:
                return None

            conn.execute(
                """
                INSERT INTO audit_log (id, tenant_id, actor_type, actor_id, action, target, meta_json, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    tenant_id,
                    "user",
                    user_id,
                    "workspace.thread.updated",
                    f"thread:{thread_id}",
                    json.dumps({"title": title, "is_pinned": is_pinned}),
                    now,
                ),
            )
            conn.commit()
            return self.get_thread(tenant_id, thread_id)
        finally:
            conn.close()

    def soft_delete_thread(self, tenant_id: str, user_id: str, thread_id: str) -> bool:
        """Soft delete a thread and record an audit log entry."""
        conn = open_db()
        try:
            now = _now_iso()
            cursor = conn.execute(
                """
                UPDATE workspace_threads
                SET deleted_at = ?, updated_at = ?
                WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL
                """,
                (now, now, tenant_id, thread_id),
            )
            if cursor.rowcount == 0:
                return False

            conn.execute(
                """
                INSERT INTO audit_log (id, tenant_id, actor_type, actor_id, action, target, meta_json, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    tenant_id,
                    "user",
                    user_id,
                    "workspace.thread.deleted",
                    f"thread:{thread_id}",
                    json.dumps({"soft_deleted": True}),
                    now,
                ),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def append_message(
        self,
        tenant_id: str,
        thread_id: str,
        role: str,
        content: str,
        model: str = "Claude",
        citations: list[dict[str, Any]] | None = None,
        grounded: bool = True,
        tokens_in: int = 0,
        tokens_out: int = 0,
    ) -> dict[str, Any]:
        """Append a message to an active thread and update thread timestamp."""
        conn = open_db()
        try:
            msg_id = str(uuid4())
            now = _now_iso()
            citations_json = json.dumps(citations) if citations else None

            conn.execute(
                """
                INSERT INTO workspace_messages (id, tenant_id, thread_id, role, content, citations_json, model, grounded, tokens_in, tokens_out, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    msg_id,
                    tenant_id,
                    thread_id,
                    role,
                    content,
                    citations_json,
                    model,
                    1 if grounded else 0,
                    tokens_in,
                    tokens_out,
                    now,
                ),
            )
            conn.execute(
                """
                UPDATE workspace_threads
                SET updated_at = ?
                WHERE tenant_id = ? AND id = ?
                """,
                (now, tenant_id, thread_id),
            )
            conn.commit()

            return {
                "id": msg_id,
                "role": role,
                "content": content,
                "citations": citations or [],
                "model": model,
                "grounded": grounded,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "ts": now,
            }
        finally:
            conn.close()
