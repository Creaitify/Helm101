"""Resolve a verified token subject to a global HELM user."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.errors import NoMembershipError
from app.auth.jwt_verifier import VerifiedSubject
from app.db.repositories.identity import IdentityRepository


@dataclass(frozen=True, slots=True)
class ResolvedIdentity:
    """A verified subject matched to a provisioned, active HELM user."""

    user_id: UUID
    issuer: str
    subject: str


async def resolve_identity(
    session: AsyncSession,
    repository: IdentityRepository,
    verified: VerifiedSubject,
) -> ResolvedIdentity:
    """Match a verified subject to a user, without auto-provisioning.

    A valid token for an unknown subject is refused with the same error as a
    missing membership. Stage 1 never creates users implicitly; provisioning is
    an audited administrative command in a later phase.
    """

    user = await repository.find_user(session, verified.issuer, verified.subject)
    if user is None:
        raise NoMembershipError
    return ResolvedIdentity(user_id=user.id, issuer=verified.issuer, subject=verified.subject)
