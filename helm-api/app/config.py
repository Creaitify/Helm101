"""Typed, environment-driven application configuration."""

from __future__ import annotations

from enum import StrEnum

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class HelmEnvironment(StrEnum):
    """Environments supported by the HELM API."""

    LOCAL = "local"
    TEST = "test"
    PREVIEW = "preview"
    STAGING = "staging"
    PRODUCTION = "production"


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

    @model_validator(mode="after")
    def reject_unsafe_production_settings(self) -> Settings:
        if self.helm_env in {HelmEnvironment.STAGING, HelmEnvironment.PRODUCTION} and "*" in self.cors_origins:
            raise ValueError("CORS_ORIGINS must not contain '*' in staging or production")
        return self



