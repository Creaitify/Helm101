"""The Anthropic adapter — the only module in HELM that names a vendor.

Everything vendor-specific lives behind this file: the SDK import, the model
parameter names, the response shape. `contracts.py` stays provider-neutral, so
adding a second provider means adding a sibling module here and one routing
entry, never touching the service.

Several request-shape rules on the current model line are load-bearing, because
getting them wrong is a 400 rather than a degraded answer:

- **No `temperature`, `top_p`, `top_k`.** All three were removed and are now
  rejected. Behaviour is steered by prompting instead.
- **No `budget_tokens`.** Manual thinking budgets were removed; depth is
  controlled by `output_config.effort`.
- **No assistant prefill.** A trailing assistant turn is rejected; response
  shape is constrained with `output_config.format` instead.
- **`effort` is not universal.** The Haiku tier rejects it, so it is sent only
  where `policy.capabilities.supports_effort` says it is accepted.
- **Thinking is on by default** on the current Opus tier, and `max_tokens` caps
  reasoning *plus* answer — so the budget must leave room for both.

And one that is a silent wrong answer rather than an error: a safety classifier
can decline with **HTTP 200** and a `refusal` stop reason. Reading the first
content block without checking `stop_reason` would return an empty string as
though it were an answer, so the check happens before content is touched.
"""

from __future__ import annotations

import time
from typing import Any

import anthropic

from app.gateway.contracts import (
    CompletionRequest,
    CompletionResponse,
    ModelRef,
    Role,
    StopReason,
    Usage,
)
from app.gateway.errors import (
    ProviderRefused,
    ProviderTimeout,
    ProviderUnavailable,
)
from app.gateway.keys import ProviderKeys
from app.gateway.policy import TaskPolicy

PROVIDER = "anthropic"

_STOP_REASONS = {
    "end_turn": StopReason.END_TURN,
    "max_tokens": StopReason.MAX_TOKENS,
    "tool_use": StopReason.TOOL_USE,
    "refusal": StopReason.REFUSAL,
}


class AnthropicAdapter:
    """Translates the gateway contract to and from the Anthropic Messages API."""

    provider = PROVIDER

    def __init__(self, keys: ProviderKeys) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=keys.require(PROVIDER))

    def serves(self, provider: str) -> bool:
        return provider == PROVIDER

    async def complete(self, request: CompletionRequest, policy: TaskPolicy) -> CompletionResponse:
        payload = self._build_payload(request, policy)
        started = time.monotonic()
        try:
            message = await self._client.messages.create(**payload)
        except anthropic.APITimeoutError as error:
            raise ProviderTimeout() from error
        except anthropic.APIConnectionError as error:
            raise ProviderUnavailable() from error
        except anthropic.RateLimitError as error:
            raise ProviderUnavailable("The model provider is rate limiting requests.") from error
        except anthropic.APIStatusError as error:
            # Deliberately does not echo `error.message`: a provider error can
            # carry prompt fragments or account detail, and the BFF contract
            # forbids surfacing raw upstream bodies.
            if error.status_code >= 500:
                raise ProviderUnavailable() from error
            raise ProviderUnavailable("The model provider rejected the request.") from error
        latency_ms = int((time.monotonic() - started) * 1000)

        stop_reason = _STOP_REASONS.get(str(message.stop_reason), StopReason.END_TURN)
        usage = self._extract_usage(message)

        if stop_reason is StopReason.REFUSAL:
            # A refusal is a successful HTTP response. Raising here is what
            # stops a caller treating empty content as an answer.
            raise ProviderRefused()

        return CompletionResponse(
            text=self._extract_text(message),
            stop_reason=stop_reason,
            model=ModelRef(provider=PROVIDER, model=policy.model.model),
            usage=usage,
            latency_ms=latency_ms,
        )

    async def aclose(self) -> None:
        await self._client.close()

    def _build_payload(self, request: CompletionRequest, policy: TaskPolicy) -> dict[str, Any]:
        capabilities = policy.capabilities
        max_tokens = min(request.max_tokens, capabilities.max_output_tokens)

        payload: dict[str, Any] = {
            "model": policy.model.model,
            "max_tokens": max_tokens,
            "messages": [
                {"role": Role(message.role).value, "content": message.content} for message in request.messages
            ],
        }

        system_blocks = self._build_system_blocks(request)
        if system_blocks:
            payload["system"] = system_blocks

        output_config: dict[str, Any] = {}
        if capabilities.supports_effort:
            output_config["effort"] = request.effort.value
        if request.json_schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": dict(request.json_schema)}
        if output_config:
            payload["output_config"] = output_config

        return payload

    def _build_system_blocks(self, request: CompletionRequest) -> list[dict[str, Any]]:
        """Split the system prompt at the cache boundary.

        Caching is a prefix match, so the stable half carries the breakpoint and
        anything varying per request follows it. Putting the volatile half first
        would invalidate the cache on every call while still paying the write
        premium.
        """

        blocks: list[dict[str, Any]] = []
        if request.system_cacheable:
            blocks.append(
                {
                    "type": "text",
                    "text": request.system_cacheable,
                    "cache_control": {"type": "ephemeral"},
                }
            )
        if request.system_volatile:
            blocks.append({"type": "text", "text": request.system_volatile})
        return blocks

    def _extract_text(self, message: Any) -> str:
        parts: list[str] = []
        for block in message.content:
            if getattr(block, "type", None) == "text":
                parts.append(str(block.text))
        return "".join(parts)

    def _extract_usage(self, message: Any) -> Usage:
        raw = message.usage
        return Usage(
            input_tokens=int(getattr(raw, "input_tokens", 0) or 0),
            output_tokens=int(getattr(raw, "output_tokens", 0) or 0),
            cache_read_tokens=int(getattr(raw, "cache_read_input_tokens", 0) or 0),
            cache_write_tokens=int(getattr(raw, "cache_creation_input_tokens", 0) or 0),
        )
