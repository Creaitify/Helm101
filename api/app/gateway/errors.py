"""Gateway failures, each carrying a stable machine-readable problem code.

Every message here is safe to return to a caller. Raw provider output is never
echoed: a provider error can carry prompt fragments or account detail, and the
BFF contract forbids surfacing either. Callers branch on `code`, never on the
HTTP status, so changing a status is a one-line edit here.
"""

from __future__ import annotations


class GatewayError(Exception):
    """Base class for every failure the gateway raises."""

    code = "gateway_error"
    status_code = 502
    detail = "The model gateway could not complete the request."

    def __init__(self, detail: str | None = None) -> None:
        super().__init__(detail or self.detail)
        if detail is not None:
            self.detail = detail


class BudgetExceeded(GatewayError):
    """The tenant's spend cap admits no further requests.

    Deliberately **409, not 402**. RFC 9110 reserves 402 for future use, so
    relying on it is speculative; the audit flagged the original 402 choice for
    exactly that reason. The `budget_exceeded` code is the contract the UI
    branches on, so moving to 402 later changes this line and nothing else.
    """

    code = "budget_exceeded"
    status_code = 409
    detail = "This tenant's model budget is exhausted."


class ModelNotPermitted(GatewayError):
    """The tenant's policy does not allow the requested task."""

    code = "model_not_permitted"
    status_code = 403
    detail = "This tenant is not permitted to use the requested capability."


class ProviderRefused(GatewayError):
    """The provider declined the request via a safety classifier.

    This arrives as a *successful* provider response with a refusal stop
    reason, not an exception — which is precisely why it needs its own type.
    Code that reads the first content block without checking the stop reason
    would treat a refusal as an answer.
    """

    code = "provider_refused"
    status_code = 422
    detail = "The model declined to answer this request."


class ProviderTimeout(GatewayError):
    """The provider did not respond within the policy's timeout."""

    code = "provider_timeout"
    status_code = 504
    detail = "The model provider did not respond in time."


class ProviderUnavailable(GatewayError):
    """The provider is unreachable, overloaded, or returned a server error.

    There is deliberately **no cross-provider fallback**. Silently retrying
    against a different vendor is exactly the behaviour the unresolved
    data-residency decision must govern; implementing it now would create an
    undocumented data path.
    """

    code = "provider_unavailable"
    status_code = 503
    detail = "The model provider is unavailable."


class ProviderKeyMissing(GatewayError):
    """No credential is configured for the provider the policy selected."""

    code = "provider_key_missing"
    status_code = 503
    detail = "The model provider is not configured."


class KillSwitchEngaged(GatewayError):
    """Model egress is frozen platform-wide.

    The gateway is authoritative for this check. A worker-side check is a
    courtesy that saves a round trip, never a control — anything that can call
    the gateway must be refused here.
    """

    code = "kill_switch_engaged"
    status_code = 503
    detail = "Model access is temporarily frozen."
