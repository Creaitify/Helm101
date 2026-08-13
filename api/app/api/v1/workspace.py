"""The grounded Workspace question endpoint.

Answers synchronously. The blueprint's async spine — enqueue, poll, resume — is
Phase 5 and does not exist yet, and a fake job resource that resolves instantly
would be a worse lie than an honest synchronous call: it would suggest a queue
that is not there and that nothing has been tested against.

Modelled on `tenants.py`, which is the canonical endpoint in this codebase.
"""

from __future__ import annotations

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import current_principal
from app.auth.principal import Principal
from app.gateway.contracts import Message, Role
from app.gateway.errors import GatewayError
from app.knowledge.analyst import AnalystService

router = APIRouter(tags=["workspace"])


class HistoryTurn(BaseModel):
    """One prior turn of the conversation, replayed by the client.

    The server stores no conversation state (persistence is a Phase 5+
    concern), so continuity is the client's job: it sends the turns it wants
    the model to see. The whole payload is caller-controlled and is treated
    as exactly that — prior *conversation*, never instructions; the system
    prompt's untrusted-content rules apply to it the same as to documents.
    """

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4_000)


class QuestionRequest(BaseModel):
    """A question to answer from HELM's documentation."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=4_000)
    # Bounded so a caller cannot stuff the context window: 20 turns of 4k
    # characters is ~20k tokens, well inside the model budget alongside the
    # retrieved sections.
    history: list[HistoryTurn] = Field(default_factory=list, max_length=20)


class CitationOut(BaseModel):
    """A citation that survived verification against the supplied text."""

    model_config = ConfigDict(extra="forbid")

    label: str
    source: str
    doc: str
    heading: str
    quote: str
    start_line: int


class AnswerMeta(BaseModel):
    """Non-authoritative context for the UI.

    `grounded` is the field that matters: it reports whether any citation
    actually verified. `tenant_scoped` is stated explicitly so a reader does
    not assume these citations point at tenant data — the corpus is platform
    documentation shared across every tenant.
    """

    model_config = ConfigDict(extra="forbid")

    grounded: bool
    source: str
    tenant_scoped: bool
    corpus_digest: str
    sections_supplied: int
    citations_rejected: int


class AnswerResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: str
    citations: list[CitationOut]
    meta: AnswerMeta


def get_analyst(request: Request) -> AnalystService:
    """Return the Analyst built at application startup."""

    analyst: AnalystService = request.app.state.analyst
    return analyst


@router.post(
    "/workspace/questions",
    response_model=AnswerResponse,
    summary="Answer a question from HELM's documentation",
)
async def ask_question(
    body: QuestionRequest,
    request: Request,
    principal: Principal = Depends(current_principal),
    analyst: AnalystService = Depends(get_analyst),
) -> AnswerResponse:
    """Answer a question, grounded in the platform's own documentation."""

    request_id = getattr(request.state, "request_id", None) or str(uuid4())
    idempotency_key = request.headers.get("Idempotency-Key")

    try:
        result = await analyst.ask(
            body.question,
            tenant_id=principal.tenant_id,
            request_id=request_id,
            idempotency_key=idempotency_key,
            history=[Message(role=Role(turn.role), content=turn.content) for turn in body.history],
        )
    except GatewayError:
        # Re-raised unchanged so the gateway's stable problem code reaches the
        # client. Wrapping it here would flatten `budget_exceeded`,
        # `provider_refused` and `kill_switch_engaged` into one opaque failure,
        # and the UI needs to tell a marketer "you are out of budget" rather
        # than "something went wrong".
        raise

    return AnswerResponse(
        data=result.answer,
        citations=[
            CitationOut(
                label=citation.label,
                source=citation.source,
                doc=citation.doc,
                heading=citation.heading,
                quote=citation.quote,
                start_line=citation.start_line,
            )
            for citation in result.citations
        ],
        meta=AnswerMeta(
            grounded=result.is_grounded,
            source="platform_docs",
            tenant_scoped=False,
            corpus_digest=result.corpus_digest,
            sections_supplied=len(result.sections_supplied),
            citations_rejected=len(result.rejected),
        ),
    )
