"""The worker's only route to a model.

There is no provider SDK here and no API key. The worker asks the control plane
a question over HTTP; the gateway inside `api/` resolves policy, reserves
budget, calls the provider, reconciles the cost and records usage. If this
module were bypassed the worker would be spending money nobody metered.

That is why the audit condemned the earlier prototype's `gateway_stub.py`: it
imported the provider SDK and read the key directly inside the worker, which
made the gateway optional in practice. Here it is structural — there is nothing
else to call.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx
import structlog

logger = structlog.get_logger(__name__)


class GatewayCallFailed(RuntimeError):
    """The control plane could not answer.

    Carries the problem `code` when the API supplied one, so a caller can tell
    `budget_exceeded` from `provider_refused` from a plain outage — the
    distinction a generic failure would erase.
    """

    def __init__(self, message: str, *, code: str = "gateway_unavailable", status_code: int = 0) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code

    @property
    def is_retryable(self) -> bool:
        """Whether trying again could plausibly succeed.

        A refusal or an exhausted budget will not resolve itself, so retrying
        only burns time. An outage or a timeout might.
        """

        return self.code in {"gateway_unavailable", "provider_unavailable", "provider_timeout"}


@dataclass(frozen=True, slots=True)
class GroundedAnswer:
    """A grounded answer plus the citations that survived verification."""

    answer: str
    citations: list[dict[str, str | int]] = field(default_factory=list)
    grounded: bool = False
    corpus_digest: str = ""
    sections_supplied: int = 0
    citations_rejected: int = 0


class GatewayClient:
    """Asks the control plane for a grounded answer."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float = 10.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(connect=2.0, read=timeout_seconds, write=5.0, pool=5.0)
        )

    async def ask(self, question: str, *, idempotency_key: str | None = None) -> GroundedAnswer:
        headers = {"Content-Type": "application/json"}
        if idempotency_key:
            # The reservation is keyed on this, so a retried request reuses its
            # hold rather than charging the tenant twice.
            headers["Idempotency-Key"] = idempotency_key

        try:
            response = await self._client.post(
                f"{self._base_url}/api/v1/workspace/questions",
                json={"question": question},
                headers=headers,
            )
        except httpx.TimeoutException as error:
            raise GatewayCallFailed("The control plane did not respond in time.", code="provider_timeout") from error
        except httpx.HTTPError as error:
            raise GatewayCallFailed("The control plane is unreachable.") from error

        if response.status_code >= 400:
            raise GatewayCallFailed(
                _problem_detail(response),
                code=_problem_code(response),
                status_code=response.status_code,
            )

        payload = response.json()
        meta = payload.get("meta", {})
        return GroundedAnswer(
            answer=payload.get("data", ""),
            citations=list(payload.get("citations", [])),
            grounded=bool(meta.get("grounded", False)),
            corpus_digest=str(meta.get("corpus_digest", "")),
            sections_supplied=int(meta.get("sections_supplied", 0)),
            citations_rejected=int(meta.get("citations_rejected", 0)),
        )

    async def complete(
        self,
        task: str,
        messages: list[dict[str, str]],
        *,
        system: str = "",
        json_schema: dict[str, object] | None = None,
        max_tokens: int = 4_096,
        idempotency_key: str | None = None,
    ) -> str:
        """Run one reasoning step of a named agent task through the gateway.

        Same custody rules as `ask`: the control plane resolves policy,
        reserves budget and calls the provider; this worker never sees a key.
        Returns the raw completion text — parsing it is the caller's job,
        because the caller declared the schema.
        """

        headers = {"Content-Type": "application/json"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        body: dict[str, object] = {"task": task, "messages": messages, "max_tokens": max_tokens}
        if system:
            body["system"] = system
        if json_schema is not None:
            body["json_schema"] = json_schema

        try:
            response = await self._client.post(
                f"{self._base_url}/api/v1/agents/completions",
                json=body,
                headers=headers,
            )
        except httpx.TimeoutException as error:
            raise GatewayCallFailed("The control plane did not respond in time.", code="provider_timeout") from error
        except httpx.HTTPError as error:
            raise GatewayCallFailed("The control plane is unreachable.") from error

        if response.status_code >= 400:
            raise GatewayCallFailed(
                _problem_detail(response),
                code=_problem_code(response),
                status_code=response.status_code,
            )

        payload = response.json()
        data = payload.get("data", "") if isinstance(payload, dict) else ""
        return str(data)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()


def _problem_code(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return "gateway_unavailable"
    code = body.get("code") if isinstance(body, dict) else None
    return str(code) if isinstance(code, str) else "gateway_unavailable"


def _problem_detail(response: httpx.Response) -> str:
    """Read the problem detail, never the raw body.

    An unparsed upstream body can carry prompt fragments or account detail, so
    a status line is returned instead when there is no structured detail.
    """

    try:
        body = response.json()
    except ValueError:
        return f"The control plane returned {response.status_code}."
    detail = body.get("detail") if isinstance(body, dict) else None
    return str(detail) if isinstance(detail, str) else f"The control plane returned {response.status_code}."
