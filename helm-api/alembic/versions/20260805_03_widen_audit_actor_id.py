"""Widen audit_log.actor_id so it can hold any issuer#subject composite.

Revision ID: 20260805_03
Revises: 20260730_02
Create Date: 2026-08-05

`users.identity_issuer` and `users.identity_subject` are each String(500).
`app/api/v1/tenants.py` composes the audit actor id as
`f"{caller.issuer}#{caller.subject}"`, which can reach 1001 characters (500 +
1 + 500). The original `audit_log.actor_id` column was String(255), so a
legitimate long issuer/subject pair (a realistic Keycloak realm URL plus a
UUID subject, and near-guaranteed for some B2C providers with long opaque
subjects) raised `StringDataRightTruncation` inside the audit-write
transaction and surfaced as an unhandled 500 for that user on every request.

The column is widened to 1010 characters: 500 + 1 ("#") + 500, plus a small
margin, matching the two source columns exactly so no valid composite actor
id can ever be rejected by the audit table.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260805_03"
down_revision = "20260730_02"
branch_labels = None
depends_on = None

NEW_LENGTH = 1010
OLD_LENGTH = 255


def upgrade() -> None:
    """Widen actor_id to fit the largest possible issuer#subject composite."""

    op.alter_column(
        "audit_log",
        "actor_id",
        type_=sa.String(length=NEW_LENGTH),
        existing_type=sa.String(length=OLD_LENGTH),
        existing_nullable=False,
    )


def downgrade() -> None:
    """Narrow actor_id back to its original length.

    This is only safe if no existing row exceeds the original 255-character
    limit; Postgres will raise if that invariant does not hold, which is the
    correct, fail-closed behaviour for a downgrade that would otherwise
    silently truncate audit data.
    """

    op.alter_column(
        "audit_log",
        "actor_id",
        type_=sa.String(length=OLD_LENGTH),
        existing_type=sa.String(length=NEW_LENGTH),
        existing_nullable=False,
    )
