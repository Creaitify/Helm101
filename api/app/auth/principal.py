"""The acting caller, however it was resolved.

`AuthenticatedCaller` is produced by the full chain: verify the token, resolve
the identity, select a membership, compute scopes. That chain reads the
database, so with no database configured there is no caller at all and every
authenticated endpoint is unreachable.

`Principal` is the narrower thing endpoints actually need — who is acting, in
which tenant, with which scopes — so a route can be written once and served
either by the real chain or, in local development only, by a fixed principal.

This is deliberately *not* a way to weaken token verification. When a database
is configured the real chain runs and this is a thin wrapper over its result.
The local variant exists so the Analyst is usable before Postgres exists, and
`Settings.reject_unsafe_production_settings` refuses it outright in staging and
production.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid5

from app.auth.membership import AuthenticatedCaller
from app.auth.scopes import Scope

# A fixed namespace, so the local principal's ids are stable between runs.
# Stability matters: a budget keyed on a tenant id that changed every restart
# would silently reset the cap.
_LOCAL_NAMESPACE = UUID("6f9619ff-8b86-d011-b42d-00c04fc964ff")


@dataclass(frozen=True, slots=True)
class Principal:
    """Who is acting, in which tenant, with which permissions."""

    user_id: UUID
    tenant_id: UUID
    tenant_slug: str
    scopes: frozenset[Scope]
    actor_id: str
    is_local_development: bool = False

    def has(self, scope: Scope) -> bool:
        return scope in self.scopes

    @classmethod
    def from_caller(cls, caller: AuthenticatedCaller) -> Principal:
        """Wrap a fully resolved caller from the real authentication chain."""

        return cls(
            user_id=caller.user_id,
            tenant_id=caller.tenant_id,
            tenant_slug=caller.tenant_slug,
            scopes=frozenset(caller.scopes),
            actor_id=f"{caller.issuer}#{caller.subject}",
            is_local_development=False,
        )

    @classmethod
    def local(cls, tenant_slug: str) -> Principal:
        """A fixed principal for local development with no database.

        Marked `is_local_development` so anything that renders or audits it can
        say plainly that this was not an authenticated caller, rather than
        letting it pass as one.
        """

        return cls(
            user_id=uuid5(_LOCAL_NAMESPACE, "local-user"),
            tenant_id=uuid5(_LOCAL_NAMESPACE, f"tenant:{tenant_slug}"),
            tenant_slug=tenant_slug,
            # Read-only. A local principal must never be able to exercise a
            # write or decide scope, because nothing verified who it is.
            scopes=frozenset({Scope.TENANT_READ, Scope.CAMPAIGN_READ, Scope.APPROVAL_READ}),
            actor_id="local-development",
            is_local_development=True,
        )
