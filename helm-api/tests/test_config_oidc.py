"""OIDC configuration must be complete or explicitly absent, never half-set."""

from __future__ import annotations

import pytest
from app.config import HelmEnvironment, Settings


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "helm_env": HelmEnvironment.TEST,
        "oidc_issuer": "https://issuer.test",
        "oidc_jwks_url": "https://issuer.test/jwks",
        "oidc_audience": "helm-api",
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_require_oidc_returns_complete_settings() -> None:
    oidc = _settings().require_oidc()
    assert oidc.issuer == "https://issuer.test"
    assert oidc.jwks_url == "https://issuer.test/jwks"
    assert oidc.audience == "helm-api"
    assert oidc.allowed_algorithms == ("RS256",)


def test_require_oidc_rejects_partial_configuration() -> None:
    with pytest.raises(RuntimeError, match="OIDC"):
        _settings(oidc_jwks_url=None).require_oidc()


def test_symmetric_algorithms_are_refused() -> None:
    with pytest.raises(ValueError, match="asymmetric"):
        _settings(oidc_allowed_algorithms=["HS256"])


def test_none_algorithm_is_refused() -> None:
    with pytest.raises(ValueError, match="asymmetric"):
        _settings(oidc_allowed_algorithms=["none"])


def test_dev_bypass_cannot_be_enabled_in_production() -> None:
    with pytest.raises(ValueError, match="staging or production"):
        _settings(helm_env=HelmEnvironment.PRODUCTION, allow_dev_unassertion=True)


def test_dev_bypass_allowed_in_local() -> None:
    assert _settings(helm_env=HelmEnvironment.LOCAL, allow_dev_unassertion=True).allow_dev_unassertion is True
