"""Durable checkpointing for agent runs.

`AsyncSqliteSaver` writes every superstep to a file, so a run survives the
process being killed. That is the whole requirement: an agent that pauses for
human approval may wait hours, and the worker holding it will be restarted,
redeployed or simply crash in that window.

**One saver per process, held for its lifetime.** Constructing a saver per
invocation is the specific defect the audit named in the earlier prototype — it
used `MemorySaver()` per CLI run, which loses everything on exit while still
looking like checkpointing from the outside. The runtime here receives its saver
as a dependency so per-invocation construction is not something a caller can
accidentally do.

Swapping to Postgres later replaces this module and nothing else: LangGraph's
`AsyncPostgresSaver` satisfies the same `BaseCheckpointSaver` interface. Until
then the checkpoint file is worker-local, so a paused run must resume on the
same worker — stated plainly in `workers/README.md` rather than discovered.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver


@asynccontextmanager
async def open_checkpointer(path: Path) -> AsyncIterator[AsyncSqliteSaver]:
    """Open the process-wide checkpoint store.

    Creates the parent directory so a fresh checkout works without setup, and
    closes the connection on exit so a killed worker leaves no half-open handle
    behind for the next one.
    """

    # A single blocking `mkdir` at process startup, before any run exists.
    # ASYNC240 is suppressed rather than satisfied: adding an async filesystem
    # dependency (trio/anyio path) to avoid one directory creation at boot
    # would be a real dependency bought for no measurable benefit.
    path.parent.mkdir(parents=True, exist_ok=True)  # noqa: ASYNC240
    async with AsyncSqliteSaver.from_conn_string(str(path)) as saver:
        yield saver
