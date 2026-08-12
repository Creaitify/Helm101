"""Select the sections that answer a question, and render them for a prompt.

Scoring is a hand-rolled BM25 over heading-anchored sections — about sixty
lines, no dependency, no embedding provider, no vector store. At roughly 2,700
lines of markdown the recall problem a vector index solves does not exist yet,
and standing one up would mean a second gateway adapter for embeddings plus a
database, for a corpus that nearly fits in a single prompt.

What retrieval *does* buy at this size is the citation anchor. Selecting whole
sections means every quotation can be checked against a known document, heading
and line range — see `citations.py`. That is why this is section-based rather
than "stuff the whole corpus in": it is about verifiability, not context limits.

A manifest of every heading is included separately and cheaply, so the model
can see what exists even when a section was not selected, and say so rather
than inventing an answer.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

from app.knowledge.sections import Section

# BM25 constants at their conventional values. `k1` bounds how much repeated
# terms help; `b` sets how strongly long sections are penalised for length.
_K1 = 1.5
_B = 0.75

_TOKEN = re.compile(r"[a-z0-9]+")

# Words that carry no signal in a corpus that is *entirely* about this platform.
# "helm" is on the list for exactly that reason: it matches everything, so it
# discriminates nothing.
_STOPWORDS = frozenset(
    """
    a an and are as at be but by for from has have how in into is it its of on or that the
    their then there these this to was were what when where which who why will with helm
    do does did can could should would you your i we our us me my if not no yes about
    """.split()
)

# Characters per token, used only to keep a selection inside its budget. It does
# not need to be exact — only stable enough that a budget means roughly the same
# thing between calls.
_CHARS_PER_TOKEN = 4


def tokenize(text: str) -> list[str]:
    return [token for token in _TOKEN.findall(text.lower()) if token not in _STOPWORDS and len(token) > 1]


@dataclass(frozen=True, slots=True)
class ScoredSection:
    section: Section
    score: float


class Corpus:
    """A scored, selectable view over a set of sections."""

    def __init__(self, sections: list[Section]) -> None:
        self._sections = sections
        self._tokens: list[list[str]] = []
        self._frequencies: list[Counter[str]] = []
        document_frequency: Counter[str] = Counter()

        for section in sections:
            # Path and heading are scored alongside the body.
            #
            # The heading matters because a section titled "The one thing
            # blocking live sign-in" should win on that phrase even when the
            # body words it differently.
            #
            # The path matters because people refer to documents by name — "what
            # did *the audit* say", "per the *auth contract*" — and without it a
            # question naming a document ranks that document no higher than any
            # other. Slashes and underscores are split by the tokenizer, so
            # `docs/reports/HELM_POST_CLEANUP_AUDIT_...md` contributes "audit".
            tokens = tokenize(f"{section.doc}\n{section.heading}\n{section.text}")
            self._tokens.append(tokens)
            counts = Counter(tokens)
            self._frequencies.append(counts)
            document_frequency.update(counts.keys())

        self._document_frequency = document_frequency
        self._average_length = (sum(len(t) for t in self._tokens) / len(self._tokens)) if self._tokens else 0.0

    def __len__(self) -> int:
        return len(self._sections)

    def search(self, question: str, *, limit: int = 8) -> list[ScoredSection]:
        """Rank sections against a question, best first, dropping non-matches."""

        query = tokenize(question)
        if not query or not self._sections:
            return []

        total = len(self._sections)
        scored: list[ScoredSection] = []

        for index, section in enumerate(self._sections):
            counts = self._frequencies[index]
            length = len(self._tokens[index]) or 1
            score = 0.0
            for term in query:
                frequency = counts.get(term, 0)
                if frequency == 0:
                    continue
                appearances = self._document_frequency[term]
                idf = math.log(1 + (total - appearances + 0.5) / (appearances + 0.5))
                denominator = frequency + _K1 * (1 - _B + _B * length / (self._average_length or 1))
                score += idf * (frequency * (_K1 + 1)) / denominator
            if score > 0:
                scored.append(ScoredSection(section=section, score=score))

        scored.sort(key=lambda item: (-item.score, item.section.doc, item.section.start_line))
        return scored[:limit]

    def select(self, question: str, *, limit: int = 8, token_budget: int = 6_000) -> list[Section]:
        """Pick the best sections that fit a token budget.

        Truncating a section would break its citation — a quote could then be
        verified against text the model never saw, or fail against text it did.
        So a section that does not fit is skipped whole and a smaller one behind
        it may take its place.
        """

        selected: list[Section] = []
        remaining = token_budget * _CHARS_PER_TOKEN

        for candidate in self.search(question, limit=limit):
            cost = len(candidate.section.text)
            if cost > remaining:
                continue
            selected.append(candidate.section)
            remaining -= cost

        return selected

    def manifest(self) -> str:
        """Every heading in the corpus, grouped by document.

        Cheap (about 1.5k tokens) and stable, so it sits in the cached prefix.
        Its job is to let the model distinguish "the docs do not cover this"
        from "that section was not retrieved" — without it, a miss looks
        identical to an absence and invites a fabricated answer.
        """

        lines: list[str] = []
        current_doc = ""
        for section in self._sections:
            if section.doc != current_doc:
                current_doc = section.doc
                lines.append(f"\n{section.doc}")
            if section.heading:
                lines.append(f"  {'  ' * max(0, section.level - 1)}- {section.heading}")
        return "\n".join(lines).strip()


def render_context(sections: list[Section]) -> str:
    """Render selected sections for the prompt, each with its citation anchor.

    The anchor is repeated on every section so the model can cite without
    inventing an identifier, and the delimiter makes the boundary between
    documents unambiguous.

    Section content is **data, never instructions**. The corpus is full of
    imperative specification prose ("you must", "never do X"), so a document
    that says "ignore previous instructions" has to be as inert as one that
    says "enable RLS". The framing here, plus the system prompt in
    `app.knowledge.prompts`, is what keeps it that way.
    """

    blocks: list[str] = []
    for section in sections:
        blocks.append(
            f"<document path=\"{section.doc}\" heading=\"{section.heading}\" "
            f"lines=\"{section.start_line}-{section.end_line}\">\n"
            f"{section.text}\n"
            f"</document>"
        )
    return "\n\n".join(blocks)
