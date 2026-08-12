"""The Analyst's knowledge layer: HELM's own documentation, made citable.

Sections are heading-anchored so every quotation can be checked against a real
document, heading and line range. `citations.verify` performs that check in
code — the model's claim about where an answer came from is never taken on
trust.
"""

from app.knowledge.citations import (
    Citation,
    VerificationResult,
    VerifiedCitation,
    parse_citations,
    verify,
)
from app.knowledge.corpus import Corpus, ScoredSection, render_context, tokenize
from app.knowledge.prompts import (
    ANALYST_SYSTEM,
    ANSWER_SCHEMA,
    build_cacheable_prefix,
    build_volatile_suffix,
)
from app.knowledge.sections import Section, digest, parse_sections
from app.knowledge.sources import KnowledgeSource, MarkdownFileSource

__all__ = [
    "ANALYST_SYSTEM",
    "ANSWER_SCHEMA",
    "Citation",
    "Corpus",
    "KnowledgeSource",
    "MarkdownFileSource",
    "ScoredSection",
    "Section",
    "VerificationResult",
    "VerifiedCitation",
    "build_cacheable_prefix",
    "build_volatile_suffix",
    "digest",
    "parse_citations",
    "parse_sections",
    "render_context",
    "tokenize",
    "verify",
]
