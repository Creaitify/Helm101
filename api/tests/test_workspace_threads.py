"""Tests for Workspace threads, messages, and agent steps persistence."""

from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import pytest
from app.db.repositories.agent_steps import AgentStepsRepository
from app.db.repositories.workspace import WorkspaceRepository
from app.db.sqlite_schema import init_sqlite_db


@pytest.fixture(autouse=True)
def setup_test_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    test_db = tmp_path / "test_helm.sqlite"
    monkeypatch.setenv("HELM_SQLITE_PATH", str(test_db))
    init_sqlite_db()


def test_thread_crud_and_soft_delete() -> None:
    repo = WorkspaceRepository()
    tenant_id = "tenant_test_123"
    user_id = "user_456"

    # Create threads
    t1 = repo.create_thread(tenant_id, user_id, "Thread 1: Financial Health Checkup", tag="analytics:30d_trends")
    t2 = repo.create_thread(tenant_id, user_id, "Thread 2: Creative Angles", tag=None)

    assert t1["title"] == "Thread 1: Financial Health Checkup"
    assert t1["tag"] == "analytics:30d_trends"
    assert t1["is_pinned"] is False

    # Pin t2
    repo.update_thread(tenant_id, user_id, t2["id"], is_pinned=True)

    # List threads (pinned first)
    threads = repo.list_threads(tenant_id, user_id)
    assert len(threads) == 2
    assert threads[0]["id"] == t2["id"]  # pinned on top
    assert threads[0]["is_pinned"] is True
    assert threads[1]["id"] == t1["id"]

    # Filter by tag
    tagged = repo.list_threads(tenant_id, user_id, tag="analytics:30d_trends")
    assert len(tagged) == 1
    assert tagged[0]["id"] == t1["id"]

    # Filter by search
    searched = repo.list_threads(tenant_id, user_id, search_query="Angles")
    assert len(searched) == 1
    assert searched[0]["id"] == t2["id"]

    # Rename t1
    updated = repo.update_thread(tenant_id, user_id, t1["id"], title="Updated Thread 1 Title")
    assert updated is not None
    assert updated["title"] == "Updated Thread 1 Title"

    # Soft delete t2
    deleted = repo.soft_delete_thread(tenant_id, user_id, t2["id"])
    assert deleted is True

    # Check listing excludes soft deleted thread
    remaining = repo.list_threads(tenant_id, user_id)
    assert len(remaining) == 1
    assert remaining[0]["id"] == t1["id"]

    # Get thread detail directly confirms it is excluded
    assert repo.get_thread(tenant_id, t2["id"]) is None


def test_append_messages_and_get_thread_history() -> None:
    repo = WorkspaceRepository()
    tenant_id = "tenant_test_123"
    user_id = "user_456"

    t = repo.create_thread(tenant_id, user_id, "Chat Memory Test")
    thread_id = t["id"]

    # Append user turn
    msg1 = repo.append_message(
        tenant_id=tenant_id,
        thread_id=thread_id,
        role="user",
        content="What is the CAC on Meta Retargeting?",
        model="Claude",
    )
    assert msg1["role"] == "user"

    # Append assistant turn
    msg2 = repo.append_message(
        tenant_id=tenant_id,
        thread_id=thread_id,
        role="assistant",
        content="Meta Retargeting CAC is ₹341 with 3.4x ROAS.",
        model="Claude",
        citations=[{"label": "[1]", "source": "docs/analytics.md", "quote": "CAC is ₹341"}],
        grounded=True,
    )
    assert msg2["role"] == "assistant"
    assert len(msg2["citations"]) == 1

    # Fetch thread with messages
    detail = repo.get_thread(tenant_id, thread_id)
    assert detail is not None
    assert len(detail["messages"]) == 2
    assert detail["messages"][0]["content"] == "What is the CAC on Meta Retargeting?"
    assert detail["messages"][1]["citations"][0]["quote"] == "CAC is ₹341"


def test_agent_steps_repository() -> None:
    steps_repo = AgentStepsRepository()
    tenant_id = "tenant_test_123"
    run_id = f"gv-run-{uuid4()}"

    s1 = steps_repo.record_step(
        tenant_id=tenant_id,
        run_id=run_id,
        hop_index=0,
        from_agent="analyst",
        to_agent="governor",
        hop_kind="analyst_findings",
        payload={"summary": "Analyst findings summary"},
        governor_rationale="Evaluated findings, preparing creative brief",
        verdict="passed",
    )
    assert s1["hop_index"] == 0

    s2 = steps_repo.record_step(
        tenant_id=tenant_id,
        run_id=run_id,
        hop_index=1,
        from_agent="governor",
        to_agent="creative",
        hop_kind="creative_brief",
        payload={"offer": "FHC ₹999"},
        governor_rationale="Dispatched brief to creative",
        verdict="routed",
    )
    assert s2["hop_index"] == 1

    # List steps for run
    steps = steps_repo.list_steps(tenant_id, run_id)
    assert len(steps) == 2
    assert steps[0]["from_agent"] == "analyst"
    assert steps[1]["from_agent"] == "governor"
    assert steps[1]["to_agent"] == "creative"
