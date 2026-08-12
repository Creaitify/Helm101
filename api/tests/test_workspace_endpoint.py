"""The Workspace question endpoint, and the local-principal guard around it."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from app.auth.principal import Principal
from app.auth.scopes import Scope
from app.config import HelmEnvironment, Settings
from app.gateway.adapters.replay import RecordedCompletion, ReplayAdapter
from app.gateway.errors import BudgetExceeded
from app.gateway.ledger import InMemoryLedger
from app.gateway.service import GatewayService
from app.knowledge.analyst import AnalystService
from app.knowledge.sources import MarkdownFileSource
from app.main import create_app
from fastapi.testclient import TestClient

CORPUS = """\
# The one thing blocking live sign-in

Create the `helm-api` API in the Auth0 tenant. Without it, Auth0 rejects the
password grant for an invalid audience.
"""


@pytest.fixture
def corpus_root(tmp_path: Path) -> Path:
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "PENDING.md").write_text(CORPUS, encoding="utf-8")
    return tmp_path


def _settings(corpus_root: Path, **overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "helm_env": HelmEnvironment.LOCAL,
        "allow_local_principal": True,
        "knowledge_root": str(corpus_root),
    }
    defaults.update(overrides)
    return Settings(**defaults)  # type: ignore[arg-type]


def _install_replay(app_client: TestClient, text: str) -> InMemoryLedger:
    """Swap in a specific recorded reply, keeping the real service path."""

    ledger = InMemoryLedger()
    gateway = GatewayService(adapter=ReplayAdapter([RecordedCompletion(text=text)]), ledger=ledger)
    state = app_client.app.state  # type: ignore[attr-defined]
    state.gateway = gateway
    state.analyst = AnalystService(
        gateway=gateway,
        source=MarkdownFileSource(Path(state.settings.knowledge_root)),
    )
    return ledger


def test_a_grounded_answer_returns_its_verified_citations(corpus_root: Path) -> None:
    client = TestClient(create_app(_settings(corpus_root)))
    _install_replay(
        client,
        json.dumps(
            {
                "answer": "Create the helm-api API in the Auth0 tenant.",
                "citations": [
                    {
                        "doc": "docs/PENDING.md",
                        "heading": "The one thing blocking live sign-in",
                        "quote": "Create the `helm-api` API in the Auth0 tenant",
                    }
                ],
            }
        ),
    )

    response = client.post("/api/v1/workspace/questions", json={"question": "what blocks live sign-in?"})

    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["grounded"] is True
    assert body["meta"]["citations_rejected"] == 0
    (citation,) = body["citations"]
    assert citation["doc"] == "docs/PENDING.md"
    assert citation["start_line"] > 0


def test_a_fabricated_citation_is_rejected_and_the_answer_is_marked_ungrounded(corpus_root: Path) -> None:
    """The verifier is what stops an invented source reaching the UI."""

    client = TestClient(create_app(_settings(corpus_root)))
    _install_replay(
        client,
        json.dumps(
            {
                "answer": "Something confident but unsupported.",
                "citations": [
                    {"doc": "docs/invented.md", "heading": "Nope", "quote": "never written"}
                ],
            }
        ),
    )

    response = client.post("/api/v1/workspace/questions", json={"question": "what blocks live sign-in?"})

    assert response.status_code == 200
    body = response.json()
    assert body["citations"] == []
    assert body["meta"]["grounded"] is False
    assert body["meta"]["citations_rejected"] == 1


def test_the_response_states_the_corpus_is_not_tenant_data(corpus_root: Path) -> None:
    """The corpus is platform documentation shared across every tenant.

    Saying so in the contract stops a future reader assuming these citations
    point at tenant data and building on a false premise.
    """

    client = TestClient(create_app(_settings(corpus_root)))
    _install_replay(client, json.dumps({"answer": "x", "citations": []}))

    meta = client.post("/api/v1/workspace/questions", json={"question": "sign-in"}).json()["meta"]

    assert meta["source"] == "platform_docs"
    assert meta["tenant_scoped"] is False


def test_an_exhausted_budget_surfaces_its_own_problem_code(corpus_root: Path) -> None:
    """A marketer must be told they are out of budget, not shown a generic failure.

    The mutation that turns this red is letting the endpoint wrap gateway
    errors in a generic 500 — `budget_exceeded`, `provider_refused` and
    `kill_switch_engaged` would all flatten into one opaque failure.
    """

    settings = _settings(corpus_root)
    client = TestClient(create_app(settings))
    ledger = _install_replay(client, json.dumps({"answer": "x", "citations": []}))
    ledger.set_cap(Principal.local(settings.local_principal_tenant_slug).tenant_id, 0)

    response = client.post("/api/v1/workspace/questions", json={"question": "sign-in"})

    assert response.status_code == BudgetExceeded.status_code
    assert response.json()["code"] == "budget_exceeded"


def test_an_empty_question_is_rejected(corpus_root: Path) -> None:
    client = TestClient(create_app(_settings(corpus_root)))

    assert client.post("/api/v1/workspace/questions", json={"question": ""}).status_code == 422


def test_without_the_local_principal_flag_the_endpoint_refuses(corpus_root: Path) -> None:
    """No database, no verifier, no explicit opt-in — the honest answer is 401.

    Serving the request would mean acting for a caller nobody identified. The
    mutation that turns this red is defaulting `allow_local_principal` to True.
    """

    client = TestClient(create_app(_settings(corpus_root, allow_local_principal=False)))

    response = client.post("/api/v1/workspace/questions", json={"question": "sign-in"})

    assert response.status_code == 401


@pytest.mark.parametrize("environment", [HelmEnvironment.STAGING, HelmEnvironment.PRODUCTION])
def test_the_local_principal_is_refused_outside_local_development(environment: HelmEnvironment) -> None:
    """It bypasses identity resolution, so it must fail closed at startup.

    The mutation that turns this red is removing the guard from
    `reject_unsafe_production_settings`.
    """

    with pytest.raises(ValueError, match="ALLOW_LOCAL_PRINCIPAL"):
        Settings(helm_env=environment, allow_local_principal=True)


def test_the_local_principal_is_read_only() -> None:
    """Nothing verified who this caller is, so it may not decide anything.

    The mutation that turns this red is granting it a write or decide scope.
    """

    principal = Principal.local("letstute")

    assert principal.is_local_development is True
    assert principal.has(Scope.TENANT_READ)
    for scope in (Scope.APPROVAL_DECIDE, Scope.CAMPAIGN_WRITE, Scope.MEMBER_WRITE):
        assert not principal.has(scope)


def test_the_local_principal_ids_are_stable_between_runs() -> None:
    """A tenant id that changed per restart would silently reset the budget cap."""

    assert Principal.local("letstute").tenant_id == Principal.local("letstute").tenant_id
    assert Principal.local("a").tenant_id != Principal.local("b").tenant_id
