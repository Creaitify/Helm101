"""Anthropic adapter: request shape and response handling.

Runs against recorded HTTP fixtures via `respx`. No test here spends money or
needs a network, and none needs an API key beyond a placeholder.

The request-shape tests matter because each forbidden parameter is a **400**,
not a degraded answer — the failure would surface at runtime as broken auth or
a broken feature rather than as a bad result.
"""

from __future__ import annotations

import httpx
import pytest
import respx
from app.gateway.adapters.anthropic import AnthropicAdapter
from app.gateway.contracts import CompletionRequest, Effort, Message, Role, StopReason, TaskKind
from app.gateway.errors import ProviderRefused, ProviderTimeout, ProviderUnavailable
from app.gateway.keys import ProviderKeys
from app.gateway.policy import resolve
from pydantic import SecretStr

MESSAGES_URL = "https://api.anthropic.com/v1/messages"

# Parameters removed from the current model line. Sending any of them is a 400.
FORBIDDEN_PARAMETERS = ("temperature", "top_p", "top_k")


@pytest.fixture
def adapter() -> AnthropicAdapter:
    return AnthropicAdapter(ProviderKeys(anthropic_api_key=SecretStr("sk-ant-placeholder")))


def _request(**overrides: object) -> CompletionRequest:
    defaults: dict[str, object] = {
        "task": TaskKind.ANALYST_ANSWER,
        "messages": [Message(role=Role.USER, content="What blocks live sign-in?")],
        "system_cacheable": "You answer questions about HELM using its documentation.",
        "max_tokens": 2_048,
    }
    defaults.update(overrides)
    return CompletionRequest(**defaults)  # type: ignore[arg-type]


def _message_body(
    *,
    text: str = "The Auth0 API registration is missing.",
    stop_reason: str = "end_turn",
) -> dict[str, object]:
    return {
        "id": "msg_01",
        "type": "message",
        "role": "assistant",
        "model": "claude-opus-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {
            "input_tokens": 1200,
            "output_tokens": 300,
            "cache_read_input_tokens": 900,
            "cache_creation_input_tokens": 0,
        },
    }


def test_the_payload_omits_every_removed_sampling_parameter(adapter: AnthropicAdapter) -> None:
    """`temperature`, `top_p` and `top_k` were removed and now return 400.

    The mutation that turns this red is adding any one of them back to
    `_build_payload`.
    """

    payload = adapter._build_payload(_request(), resolve(TaskKind.ANALYST_ANSWER))

    for parameter in FORBIDDEN_PARAMETERS:
        assert parameter not in payload


def test_the_payload_omits_a_manual_thinking_budget(adapter: AnthropicAdapter) -> None:
    """Manual thinking budgets were removed; depth is controlled by effort."""

    payload = adapter._build_payload(_request(), resolve(TaskKind.ANALYST_ANSWER))

    assert "budget_tokens" not in payload
    assert "budget_tokens" not in str(payload.get("thinking", ""))


def test_the_payload_never_ends_with_an_assistant_turn(adapter: AnthropicAdapter) -> None:
    """A trailing assistant turn is a prefill, and prefill returns 400.

    Response shape is constrained with `output_config.format` instead.
    """

    payload = adapter._build_payload(
        _request(json_schema={"type": "object", "properties": {"answer": {"type": "string"}}}),
        resolve(TaskKind.ANALYST_ANSWER),
    )

    messages = payload["messages"]
    assert isinstance(messages, list)
    assert messages[-1]["role"] != "assistant"
    assert payload["output_config"]["format"]["type"] == "json_schema"


def test_effort_comes_from_the_policy_not_the_caller(adapter: AnthropicAdapter) -> None:
    """The routing table decides reasoning depth; a caller cannot bid it up.

    The request asks for XHIGH, but the task's policy says otherwise — the
    policy value is what reaches the provider, keeping spend predictable.
    """

    policy = resolve(TaskKind.ANALYST_ANSWER)
    payload = adapter._build_payload(_request(effort=Effort.XHIGH), policy)

    assert payload["output_config"]["effort"] == policy.default_effort.value


def test_effort_is_withheld_from_a_model_that_rejects_it(adapter: AnthropicAdapter) -> None:
    """The Haiku tier rejects `effort` outright — sending it is a 400.

    The mutation that turns this red is sending `effort` unconditionally
    instead of consulting the model's capabilities.
    """

    payload = adapter._build_payload(
        _request(task=TaskKind.ANALYST_ROUTE, max_tokens=512),
        resolve(TaskKind.ANALYST_ROUTE),
    )

    assert "effort" not in payload.get("output_config", {})


def test_max_tokens_is_clamped_to_the_policy_cap(adapter: AnthropicAdapter) -> None:
    """A caller asking for millions of tokens gets the task's budget instead.

    The clamp is min(request, policy cap, model ceiling) — the policy cap is
    what makes per-task spend a config decision rather than a call-site hope.
    """

    policy = resolve(TaskKind.ANALYST_ROUTE)
    payload = adapter._build_payload(
        _request(task=TaskKind.ANALYST_ROUTE, max_tokens=10_000_000),
        policy,
    )

    assert payload["max_tokens"] == policy.default_max_tokens
    assert payload["max_tokens"] <= policy.capabilities.max_output_tokens


def test_the_cache_breakpoint_sits_on_the_stable_prefix(adapter: AnthropicAdapter) -> None:
    """Caching is a prefix match, so the volatile half must follow the stable one.

    Putting the volatile block first would invalidate the cache on every call
    while still paying the write premium. The mutation that turns this red is
    swapping the two blocks.
    """

    payload = adapter._build_payload(
        _request(system_cacheable="STABLE CORPUS MANIFEST", system_volatile="Asked at 12:01."),
        resolve(TaskKind.ANALYST_ANSWER),
    )

    blocks = payload["system"]
    assert isinstance(blocks, list)
    assert blocks[0]["text"] == "STABLE CORPUS MANIFEST"
    assert blocks[0]["cache_control"] == {"type": "ephemeral"}
    assert blocks[1]["text"] == "Asked at 12:01."
    assert "cache_control" not in blocks[1]


@respx.mock
async def test_a_successful_response_is_translated_to_the_contract(adapter: AnthropicAdapter) -> None:
    respx.post(MESSAGES_URL).mock(return_value=httpx.Response(200, json=_message_body()))

    response = await adapter.complete(_request(), resolve(TaskKind.ANALYST_ANSWER))

    assert response.text == "The Auth0 API registration is missing."
    assert response.stop_reason is StopReason.END_TURN
    assert response.model.model == resolve(TaskKind.ANALYST_ANSWER).model.model
    assert response.usage.input_tokens == 1200
    assert response.usage.output_tokens == 300
    # Recorded rather than inferred: it is the only honest confirmation that
    # prompt caching is actually working.
    assert response.usage.cache_read_tokens == 900


@respx.mock
async def test_a_refusal_arrives_as_http_200_and_still_raises(adapter: AnthropicAdapter) -> None:
    """The refusal path is a *successful* HTTP response.

    Reading `content[0]` without checking `stop_reason` would return the empty
    string as though it were an answer. The mutation that turns this red is
    removing the refusal check from `complete`.
    """

    respx.post(MESSAGES_URL).mock(
        return_value=httpx.Response(200, json=_message_body(text="", stop_reason="refusal"))
    )

    with pytest.raises(ProviderRefused):
        await adapter.complete(_request(), resolve(TaskKind.ANALYST_ANSWER))


@respx.mock
async def test_a_server_error_maps_to_provider_unavailable(adapter: AnthropicAdapter) -> None:
    respx.post(MESSAGES_URL).mock(
        return_value=httpx.Response(500, json={"error": {"message": "internal detail"}})
    )

    with pytest.raises(ProviderUnavailable) as caught:
        await adapter.complete(_request(), resolve(TaskKind.ANALYST_ANSWER))

    # The upstream body must not reach the caller.
    assert "internal detail" not in str(caught.value)


@respx.mock
async def test_a_rate_limit_maps_to_provider_unavailable(adapter: AnthropicAdapter) -> None:
    respx.post(MESSAGES_URL).mock(return_value=httpx.Response(429, json={"error": {"message": "slow down"}}))

    with pytest.raises(ProviderUnavailable) as caught:
        await adapter.complete(_request(), resolve(TaskKind.ANALYST_ANSWER))

    assert "slow down" not in str(caught.value)


@respx.mock
async def test_a_timeout_maps_to_provider_timeout(adapter: AnthropicAdapter) -> None:
    respx.post(MESSAGES_URL).mock(side_effect=httpx.TimeoutException("timed out"))

    with pytest.raises(ProviderTimeout):
        await adapter.complete(_request(), resolve(TaskKind.ANALYST_ANSWER))


@respx.mock
async def test_a_client_error_never_echoes_the_upstream_body(adapter: AnthropicAdapter) -> None:
    """A provider error can carry prompt fragments or account detail."""

    secret = "prompt-fragment-and-account-id-98765"
    respx.post(MESSAGES_URL).mock(return_value=httpx.Response(400, json={"error": {"message": secret}}))

    with pytest.raises(ProviderUnavailable) as caught:
        await adapter.complete(_request(), resolve(TaskKind.ANALYST_ANSWER))

    assert secret not in str(caught.value)


async def test_the_adapter_refuses_to_build_without_a_credential() -> None:
    from app.gateway.errors import ProviderKeyMissing

    with pytest.raises(ProviderKeyMissing):
        AnthropicAdapter(ProviderKeys())
