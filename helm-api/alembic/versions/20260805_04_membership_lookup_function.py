"""Create helm_lookup_active_memberships, a narrow SECURITY DEFINER keyhole.

Revision ID: 20260805_04
Revises: 20260805_03
Create Date: 2026-08-05

`IdentityRepository.list_active_memberships` queries `tenant_memberships`
joined to `tenants`, both `FORCE ROW LEVEL SECURITY` with policy
`tenant_id = helm_tenant_id()`. `helm_tenant_id()` reads
`current_setting('app.tenant_id', true)`, which is NULL until a tenant has
been selected -- and `NULL = anything` is NULL, so the policy admits zero
rows. This query necessarily runs *before* any tenant context exists, because
selecting which tenant to act in is the entire point of the query. Under a
role that actually respects RLS (anything without BYPASSRLS/SUPERUSER), the
query returns nothing, and `app/api/deps.py::current_caller` -- the auth path
for every authenticated request -- fails closed with `NoMembershipError` for
every user, every time. Every environment tested so far connects as a
superuser, which bypasses RLS unconditionally and masked this.

`helm-app/db/migrations/0008_membership_lookup_all.sql` solved the same
chicken-and-egg problem for the Next.js app with a narrow, parameterised
`SECURITY DEFINER` function. This migration adapts that precedent rather than
copying its signature:

- 0008 keys on lowercased email. `auth-contract.md` forbids email as an
  identity key, and Stage 1's own schema agrees: `users` is unique on
  `(identity_issuer, identity_subject)`, not on email. This function keys on
  that same pair, exactly what `app/auth/identity.py::resolve_identity` (and
  therefore `app/api/deps.py::current_caller`) already holds after verifying
  the bearer token -- no extra round trip to turn a user_id back into the
  issuer/subject pair it came from.
- 0008 returns its own `helm_role` shape (role + is_platform_admin, no
  per-membership scope overrides -- that schema has none). This function
  returns exactly the columns `MembershipRow` in
  `app/db/repositories/identity.py` needs: `membership_id`, `tenant_id`,
  `tenant_slug`, `tenant_name`, `role`, `scope_grants`, `scope_restrictions`.

Carried over unchanged, because 0008's header comment already explains why
each one is load-bearing:

- `security definer` + `set search_path = public, pg_temp`: without a pinned
  search path, a definer-rights function is hijackable by anyone who can put
  a malicious object earlier in the caller's `search_path`.
- `stable`, not `volatile`: this only reads.
- A deterministic `order by tenants.created_at asc, tenant_memberships.id
  asc`, matching `IdentityRepository.list_active_memberships`'s existing
  ORDER BY exactly. 0008 proved live that an unordered result is not a
  performance detail: it is a silent, plan-dependent privilege change (which
  tenant a multi-tenant user lands in, and with which role, could flip
  between calls).
- Filtering to active user, active membership, active tenant status.
- `revoke all ... from public` followed by an explicit, conditional grant to
  the application role, because `create or replace` does not guarantee
  privileges carry over, and the role may not exist in every environment
  (local dev, CI) that runs this migration.

What is deliberately NOT carried over: 0008 takes one scalar (email) and can
therefore return matches for arbitrary other users if email is not unique
enough. This function is intentionally narrower -- it is parameterised on the
full identity key of exactly one user and returns only that user's own
memberships, nothing else. A SECURITY DEFINER function is a deliberate,
audited hole in RLS; it must be a keyhole, not a door. This is proved in
tests/test_identity_integration.py by a dedicated cross-identity isolation
test, not merely asserted here.

One thing 0008 itself gets subtly wrong and this migration corrects: `set
search_path = public` alone does NOT remove `pg_temp` from the effective
search path. `pg_temp` is always implicitly searched FIRST unless it is
listed explicitly, and `PUBLIC` holds `TEMP` on the database by default, so
any role that can call this function can run
`create temp table users (id uuid, identity_issuer text, identity_subject
text, status text)`, populate it with an arbitrary `(issuer, subject)` -> any
real `user_id` it likes, and this SECURITY DEFINER function -- running with
elevated privileges and an implicit search path of `pg_temp, public` -- will
join against the attacker's temp table instead of the real one, handing back
another user's memberships for an identity pair that exists nowhere in the
real `users` table. This was reproduced live against an earlier, vulnerable
revision of this migration; see tests/test_identity_integration.py's
`test_membership_lookup_function_ignores_a_shadowing_temp_table` for the
regression test. The fix is `set search_path = public, pg_temp`: listing
`pg_temp` explicitly, and last, removes its implicit priority, so a
same-named object in the caller's temp schema can never be resolved ahead of
the real `public.users`/`public.tenants`/`public.tenant_memberships`.
"""

from __future__ import annotations

import os
import re

import sqlalchemy as sa
from alembic import context, op

revision = "20260805_04"
down_revision = "20260805_03"
branch_labels = None
depends_on = None

FUNCTION_NAME = "helm_lookup_active_memberships"
DEFAULT_APP_ROLE = "helm_app"

# HELM_ENV values in which a missing application role must abort the
# migration rather than silently no-op. Matches app.config.HelmEnvironment's
# staging/production members; duplicated here (as plain strings, not an
# import) because Alembic migrations must not depend on runtime application
# code -- a migration must still be runnable, and its meaning must not
# change, even if app.config is refactored or unimportable.
FAIL_CLOSED_ENVIRONMENTS = frozenset({"staging", "production"})


def _resolve_app_role() -> str:
    """Resolve the application role name to grant EXECUTE to.

    Checked in order: the Alembic `-x app_role=...` argument, then the
    `HELM_APP_ROLE` environment variable, then `DEFAULT_APP_ROLE`. A
    configurable name is required because the one non-superuser role
    provisioned anywhere so far (tests/test_identity_integration.py's
    `helm_app_role`) already does not match the hardcoded default this
    migration originally shipped with -- proof that assuming a single fixed
    name is not safe.

    PostgreSQL role names cannot be bound as query parameters in DDL (`GRANT
    ... TO :role` is not valid SQL), so the resolved name is validated against
    a strict identifier pattern before being interpolated anywhere, rather
    than trusted as opaque text from an environment variable.
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
    """Create the keyhole function and lock down its privileges.

    `set search_path = public, pg_temp` is essential, not stylistic: `pg_temp`
    is implicitly searched FIRST whenever it is not listed, and `PUBLIC` holds
    `TEMP` on the database by default. Without `pg_temp` listed explicitly
    (and last, so it loses its implicit priority), any role that can execute
    this function can `create temp table users (...)` to shadow the real
    `public.users` and make this SECURITY DEFINER function join against
    attacker-controlled data instead -- turning `(p_issuer, p_subject)` into
    an attacker-chosen key onto any real user's memberships. See
    tests/test_identity_integration.py's
    `test_membership_lookup_function_ignores_a_shadowing_temp_table`.
    """

    op.execute(
        f"""
        create or replace function {FUNCTION_NAME}(p_issuer text, p_subject text)
        returns table (
          membership_id uuid,
          tenant_id uuid,
          tenant_slug text,
          tenant_name text,
          role tenant_membership_role,
          scope_grants jsonb,
          scope_restrictions jsonb
        )
        language sql
        security definer
        set search_path = public, pg_temp
        stable
        as $$
          select
            tm.id,
            tm.tenant_id,
            t.slug,
            t.name,
            tm.role,
            tm.scope_grants,
            tm.scope_restrictions
          from users u
          join tenant_memberships tm on tm.user_id = u.id
          join tenants t on t.id = tm.tenant_id
          where u.identity_issuer = p_issuer
            and u.identity_subject = p_subject
            and u.status = 'active'
            and tm.status = 'active'
            and t.status = 'active'
          order by t.created_at asc, tm.id asc;
        $$
        """
    )

    op.execute(f"revoke all on function {FUNCTION_NAME}(text, text) from public")

    app_role = _resolve_app_role()
    helm_env = os.environ.get("HELM_ENV", "").lower()
    op.execute(
        f"""
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = '{app_role}') then
            grant execute on function {FUNCTION_NAME}(text, text) to {app_role};
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
                f"granting EXECUTE on {FUNCTION_NAME}, or every authenticated request will 500 "
                "with 'permission denied for function' at runtime. Set HELM_APP_ROLE, or pass "
                f"-x app_role=<name>, to the correct role name for this environment, or create "
                f"the role {app_role!r} first."
            )


def downgrade() -> None:
    """Drop the keyhole function."""

    op.execute(f"drop function if exists {FUNCTION_NAME}(text, text)")
