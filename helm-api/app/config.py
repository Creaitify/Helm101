"""Typed, environment-driven application configuration."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
        return self

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
        assert self.oidc_issuer is not None and self.oidc_jwks_url is not None and self.oidc_audience is not None
        return OidcSettings(
            issuer=self.oidc_issuer,
            jwks_url=self.oidc_jwks_url,
            audience=self.oidc_audience,
            allowed_algorithms=tuple(self.oidc_allowed_algorithms),
            jwks_cache_seconds=self.oidc_jwks_cache_seconds,
        )
