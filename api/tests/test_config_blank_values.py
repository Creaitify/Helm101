"""A key present-but-empty must mean the same thing as a key that is absent.

Copying `.env.example` to `.env` -- the documented first step of local setup --
leaves every optional key present with an empty value. Before this was fixed,
`DATABASE_URL=` passed `create_app`'s `is not None` guard and then crashed in
`require_database_url`, which rejects blanks. The whole test suite failed at
collection for someone who had followed the runbook exactly.
"""

from __future__ import annotations

from app.config import HelmEnvironment, Settings
from app.main import create_app


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {"helm_env": HelmEnvironment.TEST}
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_blank_database_url_is_absent_not_empty() -> None:
    assert _settings(database_url="").database_url is None


def test_whitespace_database_url_is_absent() -> None:
    assert _settings(database_url="   ").database_url is None


def test_blank_migration_url_is_absent() -> None:
    assert _settings(database_migration_url="").database_migration_url is None


def test_blank_oidc_values_are_absent() -> None:
    settings = _settings(oidc_issuer="", oidc_jwks_url="", oidc_audience="")
    assert settings.oidc_issuer is None
    assert settings.oidc_jwks_url is None
    assert settings.oidc_audience is None


def test_app_starts_with_a_freshly_copied_env_template() -> None:
    """The exact shape of `cp .env.example .env` before any value is filled in."""

    app = create_app(
        _settings(
            database_url="",
            database_migration_url="",
            oidc_issuer="",
            oidc_jwks_url="",
            oidc_audience="helm-api",
        )
    )

    assert not hasattr(app.state, "session_factory")
    assert not hasattr(app.state, "jwt_verifier")


def test_a_real_database_url_still_survives() -> None:
    settings = _settings(database_url="postgresql+asyncpg://u:p@h/db")
    assert settings.require_database_url() == "postgresql+asyncpg://u:p@h/db"
