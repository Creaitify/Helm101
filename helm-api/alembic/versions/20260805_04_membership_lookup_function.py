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

- `security definer` + `set search_path = public`: without a pinned search
  path, a definer-rights function is hijackable by anyone who can put a
  malicious object earlier in the caller's `search_path`.
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
"""

from __future__ import annotations

from alembic import op

revision = "20260805_04"
down_revision = "20260805_03"
branch_labels = None
depends_on = None

FUNCTION_NAME = "helm_lookup_active_memberships"


def upgrade() -> None:
    """Create the keyhole function and lock down its privileges."""

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
        set search_path = public
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

    op.execute(
        f"""
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'helm_app') then
            grant execute on function {FUNCTION_NAME}(text, text) to helm_app;
          end if;
        end
        $$
        """
    )


def downgrade() -> None:
    """Drop the keyhole function."""

    op.execute(f"drop function if exists {FUNCTION_NAME}(text, text)")
