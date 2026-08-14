"""Worker configuration.

Two rules are enforced here rather than documented and hoped for:

- The worker knows one HTTP base URL and nothing about model providers.
- A provider credential present in the worker's environment is a
  **configuration error**, not a convenience. The whole point of routing model
  calls through the gateway is that a compromised worker cannot spend money or
  leak a key; silently tolerating a key here would give that away.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Credentials a worker must never hold. Checked at startup so the failure is a
# clear message at boot rather than a subtle security regression nobody notices.
FORBIDDEN_CREDENTIAL_VARS = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "DATABASE_URL",
)


class WorkerSettings(BaseSettings):
    """Environment-driven settings for the agent runtime."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    helm_env: str = "local"
    log_level: str = "INFO"

    # The only address the worker knows. Every model call and every durable
    # write goes here.
    helm_api_base_url: str = "http://localhost:8000"
    request_timeout_seconds: float = 10.0

    # Where LangGraph checkpoints live. A file, not memory: the runtime has to
    # survive the process being killed, which is the whole point of it.
    state_dir: Path = Field(default=Path(".helm-worker"))

    worker_id: str = "worker-1"

    @property
    def checkpoint_path(self) -> Path:
        return self.state_dir / "checkpoints.sqlite"

    def assert_no_provider_credentials(self, environ: dict[str, str] | None = None) -> None:
        """Refuse to start while holding a credential the worker must not have.

        Fails closed and names the variable, because the alternative — starting
        anyway — means the structural guarantee ("workers never hold provider
        keys") quietly stops being true while everything still appears to work.
        """

        env = environ if environ is not None else dict(os.environ)
        present = [name for name in FORBIDDEN_CREDENTIAL_VARS if env.get(name, "").strip()]
        if present:
            raise RuntimeError(
                "Workers must not hold provider credentials or database URLs; "
                f"found: {', '.join(sorted(present))}. "
                "Model calls go through the gateway in api/, which holds the key."
            )
