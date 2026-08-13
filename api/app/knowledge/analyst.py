"""The Analyst: a grounded question answered from HELM's own documentation.

Composes the whole read-only path in one place — retrieve, prompt, call the
gateway, verify every citation — so the same logic serves the CLI now and the
agent graph later without being written twice.

The verification step is not decoration. A model asked to cite its sources will
occasionally cite a document that does not exist, or attribute a sentence to a
real document that never contained it, and both are indistinguishable from a
correct answer to a reader. An answer whose citations all fail verification is
reported as ungrounded rather than shown.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

import structlog

from app.gateway.contracts import CompletionRequest, Message, Role, TaskKind
from app.gateway.service import GatewayService
from app.knowledge.citations import Citation, VerifiedCitation, parse_citations, verify
from app.knowledge.corpus import Corpus, render_context
from app.knowledge.prompts import (
    ANSWER_SCHEMA,
    build_cacheable_prefix,
    build_volatile_suffix,
)
from app.knowledge.sections import Section
from app.knowledge.sources import KnowledgeSource

logger = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class AnalystAnswer:
    """A grounded answer plus the evidence that survived verification."""

    answer: str
    citations: list[VerifiedCitation]
    rejected: list[tuple[str, str]]
    corpus_digest: str
    sections_supplied: list[Section]

    @property
    def is_grounded(self) -> bool:
        return bool(self.citations)


class AnalystService:
    """Answers questions about HELM from HELM's own documentation."""

    def __init__(
        self,
        *,
        gateway: GatewayService,
        source: KnowledgeSource,
        section_limit: int = 8,
        token_budget: int = 6_000,
    ) -> None:
        self._gateway = gateway
        self._source = source
        self._section_limit = section_limit
        self._token_budget = token_budget

    async def ask(
        self,
        question: str,
        *,
        tenant_id: UUID,
        request_id: str = "",
        idempotency_key: str | None = None,
        history: Sequence[Message] = (),
    ) -> AnalystAnswer:
        if not question.strip():
            raise ValueError("A question cannot be empty")

        sections = await self._source.sections(tenant_id=tenant_id)
        corpus = Corpus(sections)
        selected = corpus.select(question, limit=self._section_limit, token_budget=self._token_budget)

        # Retrieval fallback chain, tried in order of specificity:
        #
        # 1. A follow-up like "tell me more about that" carries its topic in
        #    the history, not the question — rescore with the recent user
        #    turns appended.
        # 2. A question retrieval cannot score at all ("what is HELM?" is
        #    stopwords end to end) gets the corpus overview: every document's
        #    own introduction. The model then answers from real text instead
        #    of reporting an empty context.
        if not selected and history:
            recent_user_turns = " ".join(m.content for m in history[-4:] if m.role == Role.USER)
            selected = corpus.select(
                f"{question} {recent_user_turns}",
                limit=self._section_limit,
                token_budget=self._token_budget,
            )
        if not selected:
            selected = corpus.overview(token_budget=self._token_budget)

        request = CompletionRequest(
            task=TaskKind.ANALYST_ANSWER,
            messages=[*history, Message(role=Role.USER, content=question)],
            # The manifest sits in the cached half so the model can always tell
            # "not documented" from "not retrieved", even when nothing matched.
            system_cacheable=build_cacheable_prefix(corpus.manifest()),
            system_volatile=build_volatile_suffix(render_context(selected)),
            max_tokens=4_096,
            json_schema=ANSWER_SCHEMA,
            request_id=request_id,
        )

        response = await self._gateway.complete(
            request,
            tenant_id=tenant_id,
            idempotency_key=idempotency_key,
        )

        answer_text, claimed = _parse_response(response.text)
        result = verify(claimed, selected)

        logger.info(
            "analyst.answered",
            request_id=request_id,
            sections_supplied=len(selected),
            citations_claimed=len(claimed),
            citations_verified=len(result.verified),
            citations_rejected=len(result.rejected),
            grounded=result.is_grounded,
        )

        return AnalystAnswer(
            answer=answer_text,
            citations=result.verified,
            rejected=[(citation.doc, reason) for citation, reason in result.rejected],
            corpus_digest=await self._source.digest(tenant_id=tenant_id),
            sections_supplied=selected,
        )


def _parse_response(text: str) -> tuple[str, list[Citation]]:
    """Read the structured answer, degrading to plain text if it is not JSON.

    The schema is enforced by the provider, so a non-JSON body means something
    unusual happened. Returning the raw text with no citations is the honest
    outcome: the answer is shown as ungrounded rather than discarded or dressed
    up with citations it never made.
    """

    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return text.strip(), []

    if not isinstance(payload, dict):
        return text.strip(), []

    answer = payload.get("answer")
    if not isinstance(answer, str):
        return text.strip(), []

    return answer.strip(), parse_citations(payload.get("citations"))
