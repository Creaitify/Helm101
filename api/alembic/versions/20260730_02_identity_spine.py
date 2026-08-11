"""Widen membership roles and add tenant-scoped idempotency keys.

Revision ID: 20260730_02
Revises: 20260727_01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260730_02"
down_revision = "20260727_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the three missing roles and create the idempotency ledger."""

    op.execute("alter type tenant_membership_role add value if not exists 'strategist'")
    op.execute("alter type tenant_membership_role add value if not exists 'creative'")
    op.execute("alter type tenant_membership_role add value if not exists 'analyst'")

    op.create_table(
        "idempotency_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("request_fingerprint", sa.String(128), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_body", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_idempotency_keys_tenant_key"),
    )
    op.create_index("ix_idempotency_keys_tenant_created", "idempotency_keys", ["tenant_id", "created_at"])

    op.execute("alter table idempotency_keys enable row level security")
    op.execute("alter table idempotency_keys force row level security")
    op.execute(
        "create policy idempotency_keys_tenant_isolation on idempotency_keys "
        "using (tenant_id = helm_tenant_id()) "
        "with check (tenant_id = helm_tenant_id())"
    )


def downgrade() -> None:
    """Drop the idempotency ledger.

    PostgreSQL cannot remove a value from an enum type, so the three added roles
    are intentionally not reverted. Re-running upgrade is safe because each add
    uses 'if not exists'.
    """

    op.execute("drop policy if exists idempotency_keys_tenant_isolation on idempotency_keys")
    op.execute("alter table idempotency_keys no force row level security")
    op.execute("alter table idempotency_keys disable row level security")
    op.drop_index("ix_idempotency_keys_tenant_created", table_name="idempotency_keys")
    op.drop_table("idempotency_keys")
