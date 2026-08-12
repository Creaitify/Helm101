"""Provider adapters. Only modules in this package may name a vendor."""

from app.gateway.adapters.base import ProviderAdapter
from app.gateway.adapters.replay import RecordedCompletion, ReplayAdapter

# `anthropic.py` is deliberately not re-exported here. Importing it pulls in the
# provider SDK, and the replay adapter must stay usable — in tests and in a
# no-credential local run — without that dependency being loaded.
__all__ = ["ProviderAdapter", "RecordedCompletion", "ReplayAdapter"]
