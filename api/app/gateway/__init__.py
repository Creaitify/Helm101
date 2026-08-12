"""HELM's model gateway — the only door to model providers.

No component outside this package may call a provider directly, and no
component outside `adapters/` may name one. Workers reach models through the
gateway's HTTP surface and never hold a provider credential.
"""

from app.gateway.contracts import (
    BudgetSnapshot,
    CompletionRequest,
    CompletionResponse,
    Effort,
    Message,
    ModelRef,
    Reservation,
    Role,
    StopReason,
    TaskKind,
    Usage,
    UsageRecord,
)
from app.gateway.errors import (
    BudgetExceeded,
    GatewayError,
    KillSwitchEngaged,
    ModelNotPermitted,
    ProviderKeyMissing,
    ProviderRefused,
    ProviderTimeout,
    ProviderUnavailable,
)
from app.gateway.keys import ProviderKeys
from app.gateway.ledger import BudgetLedger, InMemoryLedger
from app.gateway.service import GatewayService

__all__ = [
    "BudgetExceeded",
    "BudgetLedger",
    "BudgetSnapshot",
    "CompletionRequest",
    "CompletionResponse",
    "Effort",
    "GatewayError",
    "GatewayService",
    "InMemoryLedger",
    "KillSwitchEngaged",
    "Message",
    "ModelNotPermitted",
    "ModelRef",
    "ProviderKeyMissing",
    "ProviderKeys",
    "ProviderRefused",
    "ProviderTimeout",
    "ProviderUnavailable",
    "Reservation",
    "Role",
    "StopReason",
    "TaskKind",
    "Usage",
    "UsageRecord",
]
