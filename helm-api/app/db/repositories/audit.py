"""Append-only audit repository with allow-listed metadata."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.audit import AuditActorType, AuditLog
from app.db.tenant_context import TenantContext

ALLOWED_AUDIT_METADATA_KEYS = frozenset(
    {"event_version", "reason_code", "policy_version", "resource_version", "source", "outcome", "error_code"}
)

# Must match the audit_log.actor_id column width (see
# alembic/versions/20260805_03_widen_audit_actor_id.py). Validated here too so a
# caller composing an oversized actor id gets a clear ValueError from the
# repository instead of a database-level StringDataRightTruncation surfacing as
# an unhandled 500 deep inside a transaction.
MAX_ACTOR_ID_LENGTH = 1010


@dataclass(frozen=True, slots=True)
class AuditEvent:
    actor_type: AuditActorType
    actor_id: str
    action: str
    target: str
    request_id: str
    metadata: Mapping[str, Any] = field(default_factory=dict)


class AuditRepository:
    """Writes audit records through an already tenant-scoped transaction."""

    async def append(self, session: AsyncSession, context: TenantContext | None, event: AuditEvent) -> AuditLog:
        if context is None:
            raise ValueError("A tenant context is required for audit writes")
        if len(event.actor_id) > MAX_ACTOR_ID_LENGTH:
            raise ValueError(f"actor_id must be at most {MAX_ACTOR_ID_LENGTH} characters")
        unsupported = set(event.metadata) - ALLOWED_AUDIT_METADATA_KEYS
        if unsupported:
            raise ValueError("Audit metadata contains unsupported keys")
        if any(not isinstance(value, (str, int, float, bool, type(None))) for value in event.metadata.values()):
            raise ValueError("Audit metadata values must be scalar codes, not nested content")
        if any(isinstance(value, str) and len(value) > 128 for value in event.metadata.values()):
            raise ValueError("Audit metadata values must be short opaque codes")

        record = AuditLog(
            tenant_id=context.tenant_id,
            actor_type=event.actor_type,
            actor_id=event.actor_id,
            action=event.action,
            target=event.target,
            request_id=event.request_id,
            metadata_json=dict(event.metadata),
        )
        session.add(record)
        await session.flush()
        return record
