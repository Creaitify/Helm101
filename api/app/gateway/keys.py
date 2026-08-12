"""The single accessor for provider credentials.

Every provider key in the platform is read here and nowhere else. That is the
whole point of the module: when a vault or KMS finally arrives (open decision
#4, deliberately deferred), it replaces this one file rather than a scatter of
`os.environ` reads across adapters.

Two rules this enforces structurally:

- Keys never leave the API process. Workers reach models through the gateway's
  HTTP surface and hold no credential of their own.
- A key is never logged, echoed in an error, or included in a problem
  response. `describe()` exists so operators can confirm configuration without
  the value appearing anywhere.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import SecretStr

from app.gateway.errors import ProviderKeyMissing


@dataclass(frozen=True, slots=True)
class ProviderKeys:
    """Provider credentials resolved once at application startup."""

    anthropic_api_key: SecretStr | None = None

    def require(self, provider: str) -> str:
        """Return the credential for a provider, or refuse clearly.

        The error names the provider but never the value, and never says
        whether some *other* provider is configured.
        """

        key = self._lookup(provider)
        if key is None:
            raise ProviderKeyMissing(f"No credential configured for provider {provider!r}.")
        return key.get_secret_value()

    def has(self, provider: str) -> bool:
        """Whether a provider is configured, without resolving the value."""

        return self._lookup(provider) is not None

    def describe(self) -> dict[str, bool]:
        """Report configuration state as booleans, for readiness output.

        Deliberately returns presence rather than values, so this can be
        rendered into an operational endpoint without leaking a secret.
        """

        return {"anthropic": self.anthropic_api_key is not None}

    def _lookup(self, provider: str) -> SecretStr | None:
        if provider == "anthropic":
            return self.anthropic_api_key
        return None
