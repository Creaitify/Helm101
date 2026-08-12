"""Typed, environment-driven application configuration."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.gateway.keys import ProviderKeys


class HelmEnvironment(StrEnum):
    """Environments supported by the HELM API."""

    LOCAL = "local"
    TEST = "test"
    PREVIEW = "preview"
    STAGING = "staging"
    PRODUCTION = "production"


ASYMMETRIC_ALGORITHMS = frozenset({"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"})


@dataclass(frozen=True, slots=True)
class OidcSettings:
    """Complete, validated OIDC verification settings."""

    issuer: str
    jwks_url: str
    audience: str
    allowed_algorithms: tuple[str, ...]
    jwks_cache_seconds: int


class Settings(BaseSettings):
    """Settings loaded from environment variables and an optional local env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    helm_env: HelmEnvironment = HelmEnvironment.LOCAL
    app_name: str = "HELM API"
    app_version: str = "0.1.0"
    log_level: str = "INFO"
    cors_origins: list[str] = Field(default_factory=list)
    database_url: SecretStr | None = None
    database_migration_url: SecretStr | None = None
    oidc_issuer: str | None = None
    oidc_jwks_url: str | None = None
    oidc_audience: str | None = None
    oidc_allowed_algorithms: list[str] = Field(default_factory=lambda: ["RS256"])
    oidc_jwks_cache_seconds: int = 300
    allow_dev_unassertion: bool = False

    # --- Model gateway ---------------------------------------------------
    anthropic_api_key: SecretStr | None = None
    gateway_kill_switch: bool = False
    gateway_default_cap_micros: int = 20_000_000

    # --- Knowledge corpus ------------------------------------------------
    # Defaults to the repository root, which is what makes the Analyst work on
    # a fresh clone with no configuration at all.
    knowledge_root: str | None = None

    # --- Local-only escape hatch -----------------------------------------
    # Resolving a caller's identity and memberships is a database read, so with
    # no database configured there is no authenticated caller and every
    # authenticated endpoint is unreachable. This yields a fixed local
    # principal instead, so the Analyst is usable before Postgres exists.
    #
    # It is off by default and refused outright in staging and production, the
    # same guard `allow_dev_unassertion` already establishes. Token
    # verification itself is never weakened by it: when a database *is*
    # configured, the real chain runs.
    allow_local_principal: bool = False
    local_principal_tenant_slug: str = "letstute"

    @field_validator(
        "database_url",
        "database_migration_url",
        "oidc_issuer",
        "oidc_jwks_url",
        "oidc_audience",
        "anthropic_api_key",
        "knowledge_root",
        mode="before",
    )
    @classmethod
    def treat_blank_as_absent(cls, value: object) -> object:
        """Collapse a present-but-empty key to None.

        `cp .env.example .env` is the documented first step of local setup, and
        it leaves every optional key present with an empty value. Without this,
        `DATABASE_URL=` clears `create_app`'s `is not None` guard and then fails
        in `require_database_url`, which rejects blanks -- so a correctly
        followed runbook produces a service that cannot start and a test suite
        that dies at collection. Absent and empty must mean the same thing.
        """

        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        normalized = value.upper()
        valid_levels = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}
        if normalized not in valid_levels:
            raise ValueError("LOG_LEVEL must be a standard Python log level")
        return normalized

    @field_validator("cors_origins")
    @classmethod
    def normalize_cors_origins(cls, value: list[str]) -> list[str]:
        return [origin.rstrip("/") for origin in value]

    @field_validator("oidc_allowed_algorithms")
    @classmethod
    def validate_algorithms(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("OIDC_ALLOWED_ALGORITHMS must not be empty")
        unsupported = [algorithm for algorithm in value if algorithm not in ASYMMETRIC_ALGORITHMS]
        if unsupported:
            raise ValueError(
                "OIDC_ALLOWED_ALGORITHMS must contain only asymmetric algorithms; "
                "symmetric or 'none' algorithms permit token forgery against a public JWKS"
            )
        return value

    @model_validator(mode="after")
    def reject_unsafe_production_settings(self) -> Settings:
        if self.helm_env in {HelmEnvironment.STAGING, HelmEnvironment.PRODUCTION} and "*" in self.cors_origins:
            raise ValueError("CORS_ORIGINS must not contain '*' in staging or production")
        if self.allow_dev_unassertion and self.helm_env in {HelmEnvironment.STAGING, HelmEnvironment.PRODUCTION}:
            raise ValueError("ALLOW_DEV_UNASSERTION must never be enabled in staging or production")
        if self.allow_local_principal and self.helm_env in {HelmEnvironment.STAGING, HelmEnvironment.PRODUCTION}:
            raise ValueError(
                "ALLOW_LOCAL_PRINCIPAL must never be enabled in staging or production; "
                "it bypasses identity and membership resolution entirely"
            )
        return self

    def gateway_keys(self) -> ProviderKeys:
        """Provider credentials, read in exactly one place."""

        return ProviderKeys(anthropic_api_key=self.anthropic_api_key)

    def resolve_knowledge_root(self) -> Path:
        """Where the Analyst's corpus lives.

        Defaults to the repository root so a fresh clone works with no
        configuration: `app/config.py` → `app` → `api` → repository root.
        """

        if self.knowledge_root:
            return Path(self.knowledge_root)
        return Path(__file__).resolve().parents[2]

    def require_database_url(self) -> str:
        """Return the pooled application URL only for database operations."""

        if self.database_url is None or not self.database_url.get_secret_value().strip():
            raise RuntimeError("DATABASE_URL is required for application database operations")
        return self.database_url.get_secret_value()

    def require_migration_database_url(self) -> str:
        """Return the privileged unpooled URL only for Alembic migrations."""

        if self.database_migration_url is None or not self.database_migration_url.get_secret_value().strip():
            raise RuntimeError("DATABASE_MIGRATION_URL is required for database migrations")
        return self.database_migration_url.get_secret_value()

    def require_oidc(self) -> OidcSettings:
        """Return complete OIDC settings or refuse to serve authenticated traffic."""

        missing = [
            name
            for name, value in (
                ("OIDC_ISSUER", self.oidc_issuer),
                ("OIDC_JWKS_URL", self.oidc_jwks_url),
                ("OIDC_AUDIENCE", self.oidc_audience),
            )
            if value is None or not value.strip()
        ]
        if missing:
            raise RuntimeError(f"OIDC configuration is incomplete; missing: {', '.join(missing)}")
        if self.oidc_issuer is not None and self.oidc_jwks_url is not None:
            # The issuer and its JWKS document must come from the same origin.
            # A JWKS URL pasted from a different tenant produces the most
            # confusing failure in this system: signatures verify against keys
            # the real issuer never published, or fail with nothing to indicate
            # the URL is the problem. Compare origins only -- the issuer's path
            # and trailing slash are the issuer's business (Auth0 emits a
            # trailing slash in `iss`, others do not) and this must stay
            # provider-agnostic.
            issuer_origin = urlsplit(self.oidc_issuer)
            jwks_origin = urlsplit(self.oidc_jwks_url)
            if (issuer_origin.scheme, issuer_origin.netloc) != (jwks_origin.scheme, jwks_origin.netloc):
                raise RuntimeError(
                    "OIDC_JWKS_URL must share an origin with OIDC_ISSUER; "
                    "a JWKS document from a different host cannot hold the issuer's signing keys"
                )

        if self.oidc_issuer is None or self.oidc_jwks_url is None or self.oidc_audience is None:
            # Unreachable: the `missing` check above already enforces this invariant.
            # An explicit raise (not `assert`) narrows the types for mypy without
            # depending on assertions, which are stripped under `python -O`.
            raise RuntimeError("OIDC configuration is incomplete")
        return OidcSettings(
            issuer=self.oidc_issuer,
            jwks_url=self.oidc_jwks_url,
            audience=self.oidc_audience,
            allowed_algorithms=tuple(self.oidc_allowed_algorithms),
            jwks_cache_seconds=self.oidc_jwks_cache_seconds,
        )
