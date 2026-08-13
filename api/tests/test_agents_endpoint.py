"""The agent completions endpoint: the one model door for workers."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.config import HelmEnvironment, Settings
from app.gateway.adapters.replay import RecordedCompletion, ReplayAdapter
from app.gateway.contracts import TaskKind
from app.gateway.ledger import InMemoryLedger
from app.gateway.policy import resolve
from app.gateway.service import GatewayService
from app.main import create_app
from fastapi.testclient import TestClient


@pytest.fixture
def corpus_root(tmp_path: Path) -> Path:
    (tmp_path / "README.md").write_text("# HELM\n\nA platform.\n", encoding="utf-8")
    return tmp_path


def _client(corpus_root: Path) -> tuple[TestClient, ReplayAdapter]:
    settings = Settings(
        helm_env=HelmEnvironment.LOCAL,
        allow_local_principal=True,
        knowledge_root=str(corpus_root),
    )
    client = TestClient(create_app(settings))
    adapter = ReplayAdapter([RecordedCompletion(text='{"ok": true}')])
    client.app.state.gateway = GatewayService(adapter=adapter, ledger=InMemoryLedger())  # type: ignore[attr-defined]
    return client, adapter


def test_a_named_agent_task_routes_through_the_gateway(corpus_root: Path) -> None:
    client, adapter = _client(corpus_root)

    response = client.post(
        "/api/v1/agents/completions",
        json={
            "task": "media_buyer.proposal",
            "system": "You propose budget shifts.",
            "messages": [{"role": "user", "content": "here are the campaigns"}],
        },
    )

    assert response.status_code == 200
    assert response.json()["data"] == '{"ok": true}'
    (request,) = adapter.calls
    assert request.task is TaskKind.MEDIA_BUYER_PROPOSAL
    assert request.system_cacheable == "You propose budget shifts."


def test_an_unknown_task_is_refused_with_its_own_code(corpus_root: Path) -> None:
    client, _ = _client(corpus_root)

    response = client.post(
        "/api/v1/agents/completions",
        json={"task": "made.up", "messages": [{"role": "user", "content": "x"}]},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "unknown_agent_task"


def test_the_analyst_task_is_not_reachable_raw(corpus_root: Path) -> None:
    """The Analyst stays behind the workspace endpoint, where retrieval and
    citation verification wrap it. This endpoint must not be a second,
    unverified path to the same capability."""

    client, _ = _client(corpus_root)

    response = client.post(
        "/api/v1/agents/completions",
        json={"task": "analyst.answer", "messages": [{"role": "user", "content": "x"}]},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "unknown_agent_task"


@pytest.mark.parametrize(
    "task",
    [TaskKind.MEDIA_BUYER_PROPOSAL, TaskKind.CREATIVE_VARIANTS, TaskKind.GOVERNOR_PLAN],
)
def test_every_agent_task_has_a_routing_policy(task: TaskKind) -> None:
    """An unrouted task raises at call time; catching it here keeps the error
    at the table where the decision belongs."""

    policy = resolve(task)
    assert policy.model.provider == "anthropic"
