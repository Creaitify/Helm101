"""Create HELM tenant, identity, membership, and append-only audit foundations.

Revision ID: 20260727_01
Revises:
Create Date: 2026-07-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260727_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("create extension if not exists pgcrypto")
    op.execute("create type tenant_status as enum ('active', 'suspended', 'archived')")
    op.execute("create type user_status as enum ('active', 'invited', 'suspended')")
    op.execute("create type tenant_membership_role as enum ('owner', 'agency_admin', 'client_viewer')")
    op.execute("create type tenant_membership_status as enum ('active', 'invited', 'suspended')")
    op.execute("create type audit_actor_type as enum ('user', 'agent', 'system')")

    op.create_table(
        "tenants",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("plan", sa.String(length=100), nullable=False, server_default=sa.text("'starter'")),
        sa.Column(
            "status",
            postgresql.ENUM(name="tenant_status", create_type=False),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("slug", name="uq_tenants_slug"),
    )
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("identity_issuer", sa.String(length=500), nullable=False),
        sa.Column("identity_subject", sa.String(length=500), nullable=False),
        sa.Column("email_normalized", sa.String(length=320), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(name="user_status", create_type=False),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("identity_issuer", "identity_subject", name="uq_users_identity_issuer_subject"),
        sa.CheckConstraint("email_normalized = lower(email_normalized)", name="users_email_normalized"),
    )
    op.create_table(
        "tenant_memberships",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", postgresql.ENUM(name="tenant_membership_role", create_type=False), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(name="tenant_membership_status", create_type=False),
            nullable=False,
            server_default=sa.text("'invited'"),
        ),
        sa.Column("scope_grants", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("scope_restrictions", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_tenant_memberships_tenant_user"),
        sa.CheckConstraint("jsonb_typeof(scope_grants) = 'array'", name="memberships_scope_grants_array"),
        sa.CheckConstraint("jsonb_typeof(scope_restrictions) = 'array'", name="memberships_scope_restrictions_array"),
    )
    op.create_table(
        "audit_log",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_type", postgresql.ENUM(name="audit_actor_type", create_type=False), nullable=False),
        sa.Column("actor_id", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=255), nullable=False),
        sa.Column("target", sa.String(length=500), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("request_id", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.CheckConstraint("jsonb_typeof(metadata) = 'object'", name="audit_metadata_object"),
        sa.CheckConstraint(
            "(metadata - array['event_version', 'reason_code', 'policy_version', "
            "'resource_version', 'source', 'outcome', 'error_code']) = '{}'::jsonb",
            name="audit_metadata_allowlist",
        ),
    )
    op.create_index("ix_tenant_memberships_tenant_status", "tenant_memberships", ["tenant_id", "status"])
    op.create_index("ix_tenant_memberships_tenant_user", "tenant_memberships", ["tenant_id", "user_id"])
    op.create_index("ix_audit_log_tenant_created", "audit_log", ["tenant_id", sa.text("created_at desc")])

    op.execute(
        """
        create or replace function helm_tenant_id() returns uuid language sql stable as $$
          select nullif(current_setting('app.tenant_id', true), '')::uuid;
        $$
        """
    )
    for table_name in ("tenants", "tenant_memberships", "audit_log"):
        op.execute(f"alter table {table_name} enable row level security")
        op.execute(f"alter table {table_name} force row level security")

    op.execute(
        "create policy tenants_tenant_isolation on tenants "
        "using (id = helm_tenant_id()) "
        "with check (id = helm_tenant_id())"
    )
    op.execute(
        "create policy tenant_memberships_tenant_isolation on tenant_memberships "
        "using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id())"
    )
    op.execute(
        "create policy audit_log_tenant_isolation on audit_log "
        "using (tenant_id = helm_tenant_id()) with check (tenant_id = helm_tenant_id())"
    )
    op.execute(
        """
        create or replace function prevent_audit_log_mutation() returns trigger language plpgsql as $$
        begin
          raise exception 'audit_log is append-only';
        end;
        $$
        """
    )
    op.execute(
        "create trigger audit_log_no_update_or_delete before update or delete on audit_log "
        "for each row execute function prevent_audit_log_mutation()"
    )
    op.execute(
        """
        create or replace function set_foundation_updated_at() returns trigger language plpgsql as $$
        begin
          new.updated_at = now();
          return new;
        end;
        $$
        """
    )
    for table_name in ("tenants", "users", "tenant_memberships"):
        op.execute(
            f"create trigger {table_name}_set_updated_at before update on {table_name} "
            "for each row execute function set_foundation_updated_at()"
        )


def downgrade() -> None:
    for table_name in ("tenant_memberships", "users", "tenants"):
        op.execute(f"drop trigger if exists {table_name}_set_updated_at on {table_name}")
    op.execute("drop function if exists set_foundation_updated_at()")
    op.execute("drop trigger if exists audit_log_no_update_or_delete on audit_log")
    op.execute("drop function if exists prevent_audit_log_mutation()")
    op.execute("drop policy if exists audit_log_tenant_isolation on audit_log")
    op.execute("drop policy if exists tenant_memberships_tenant_isolation on tenant_memberships")
    op.execute("drop policy if exists tenants_tenant_isolation on tenants")
    for table_name in ("audit_log", "tenant_memberships", "tenants"):
        op.execute(f"alter table {table_name} no force row level security")
        op.execute(f"alter table {table_name} disable row level security")
    op.execute("drop function if exists helm_tenant_id()")
    op.drop_index("ix_audit_log_tenant_created", table_name="audit_log")
    op.drop_index("ix_tenant_memberships_tenant_user", table_name="tenant_memberships")
    op.drop_index("ix_tenant_memberships_tenant_status", table_name="tenant_memberships")
    op.drop_table("audit_log")
    op.drop_table("tenant_memberships")
    op.drop_table("users")
    op.drop_table("tenants")
    op.execute("drop type audit_actor_type")
    op.execute("drop type tenant_membership_status")
    op.execute("drop type tenant_membership_role")
    op.execute("drop type user_status")
    op.execute("drop type tenant_status")
