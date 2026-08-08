"""Create helm_lookup_active_tenant_by_slug, a narrow SECURITY DEFINER keyhole.

Revision ID: 20260805_05
Revises: 20260805_04
Create Date: 2026-08-05

`app/cli/provision.py::provision_member` (Task 5, the audited provisioning
command) must resolve a tenant by slug before any tenant context exists --
choosing which tenant to provision a membership into is the entire point of
the lookup. `tenants` is `FORCE ROW LEVEL SECURITY` with policy
`id = helm_tenant_id()`, and `helm_tenant_id()` reads
`current_setting('app.tenant_id', true)`, which is NULL until a tenant has
been selected. Under any role that actually respects RLS (i.e. not
BYPASSRLS/SUPERUSER), a plain `select * from tenants where slug = ...` before
context is set returns zero rows unconditionally -- the exact chicken-and-egg
problem `helm_lookup_active_memberships`
(20260805_04_membership_lookup_function.py) already solves for membership
resolution. This migration adapts that same precedent for the one additional
pre-context lookup Task 5 needs: tenant-by-slug rather than
memberships-by-identity.

Carried over unchanged, because 20260805_04's header comment already explains
why each one is load-bearing:

- `security definer` + `set search_path = public, pg_temp`: without a pinned
  search path, a definer-rights function is hijackable by anyone who can put
  a malicious object earlier in the caller's `search_path` (see
  20260805_04's docstring for the live `pg_temp`-shadowing reproduction this
  guards against).
- `stable`, not `volatile`: this only reads.
- Filtering to `status = 'active'`, matching `provision_member`'s own
  pre-migration in-process filter -- an archived or suspended tenant must not
  be provisionable.
- `revoke all ... from public` followed by an explicit, conditional grant to
  the application role, because `create or replace` does not guarantee
  privileges carry over, and the role may not exist in every environment
  (local dev, CI) that runs this migration.

Deliberately narrower than 0008/20260805_04's identity keyhole: this takes
one plain scalar (the tenant slug, already unique via
`uq_tenants_slug`) and returns only that one tenant's own public identifying
columns (`id`, `slug`, `name`, `status`) -- no membership or scope data, and
no way to enumerate tenants by anything other than an exact slug match.
"""

from __future__ import annotations

import os
import re

import sqlalchemy as sa
from alembic import context, op

revision = "20260805_05"
down_revision = "20260805_04"
branch_labels = None
depends_on = None

FUNCTION_NAME = "helm_lookup_active_tenant_by_slug"
DEFAULT_APP_ROLE = "helm_app"

# Matches 20260805_04_membership_lookup_function.py's FAIL_CLOSED_ENVIRONMENTS
# exactly, for the same reason: staging/production must not silently end up
# with a keyhole function no role can call.
FAIL_CLOSED_ENVIRONMENTS = frozenset({"staging", "production"})


def _resolve_app_role() -> str:
    """Resolve the application role name to grant EXECUTE to.

    Identical resolution order and identifier validation to
    20260805_04_membership_lookup_function.py::_resolve_app_role; duplicated
    rather than imported because Alembic migrations must not depend on other
    migration modules, whose contents can change independently of this one.
    """

    x_args = context.get_x_argument(as_dictionary=True)
    role = x_args.get("app_role") or os.environ.get("HELM_APP_ROLE") or DEFAULT_APP_ROLE
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", role):
        raise ValueError(
            f"Resolved application role name {role!r} is not a plain lowercase SQL identifier; "
            "refusing to interpolate it into GRANT/DO DDL. Check HELM_APP_ROLE or -x app_role=..."
        )
    return role


def upgrade() -> None:
    """Create the keyhole function and lock down its privileges."""

    op.execute(
        f"""
        create or replace function {FUNCTION_NAME}(p_slug text)
        returns table (
          id uuid,
          slug text,
          name text,
          status tenant_status
        )
        language sql
        security definer
        set search_path = public, pg_temp
        stable
        as $$
          select t.id, t.slug, t.name, t.status
          from tenants t
          where t.slug = p_slug
            and t.status = 'active';
        $$
        """
    )

    op.execute(f"revoke all on function {FUNCTION_NAME}(text) from public")

    app_role = _resolve_app_role()
    helm_env = os.environ.get("HELM_ENV", "").lower()
    op.execute(
        f"""
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = '{app_role}') then
            grant execute on function {FUNCTION_NAME}(text) to {app_role};
          end if;
        end
        $$
        """
    )
    if helm_env in FAIL_CLOSED_ENVIRONMENTS:
        connection = op.get_bind()
        role_exists = connection.execute(
            sa.text("select 1 from pg_roles where rolname = :role"), {"role": app_role}
        ).first()
        if role_exists is None:
            raise RuntimeError(
                f"HELM_ENV={helm_env!r} requires application role {app_role!r} to exist before "
                f"granting EXECUTE on {FUNCTION_NAME}, or app.cli.provision will fail with "
                "'permission denied for function' at runtime. Set HELM_APP_ROLE, or pass "
                f"-x app_role=<name>, to the correct role name for this environment, or create "
                f"the role {app_role!r} first."
            )


def downgrade() -> None:
    """Drop the keyhole function."""

    op.execute(f"drop function if exists {FUNCTION_NAME}(text)")
