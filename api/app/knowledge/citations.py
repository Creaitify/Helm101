"""Verify, in code, that every citation an answer makes is real.

This is the module that turns "grounded" from a label on a chip into a property
that can be checked. A model asked to cite its sources will sometimes cite a
document that does not exist, or attribute a quotation to a real document that
never contained it. Both are indistinguishable from a correct answer to anyone
reading the output.

Three checks, all mechanical, all against the sections that were actually in
the prompt for *this* call:

1. the cited document exists in the corpus;
2. the cited heading resolves to a real section that was supplied;
3. the quoted text genuinely appears in that section.

A citation failing any of them is dropped, and an answer left with no verified
citation is refused rather than shown. This follows the audit's rule that policy
calculations belong in code rather than being trusted from the model.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.knowledge.sections import Section


@dataclass(frozen=True, slots=True)
class Citation:
    """A claim the model made about where its answer came from."""

    doc: str
    heading: str
    quote: str


@dataclass(frozen=True, slots=True)
class VerifiedCitation:
    """A citation checked against the sections actually supplied."""

    doc: str
    heading: str
    quote: str
    start_line: int
    end_line: int

    @property
    def label(self) -> str:
        """Short display text — the heading, or the filename when there is none."""

        return self.heading or self.doc.rsplit("/", maxsplit=1)[-1]

    @property
    def source(self) -> str:
        """The document path, shown beneath the label in the UI."""

        return f"{self.doc}:{self.start_line}"


@dataclass(frozen=True, slots=True)
class VerificationResult:
    verified: list[VerifiedCitation]
    rejected: list[tuple[Citation, str]]

    @property
    def is_grounded(self) -> bool:
        return bool(self.verified)


def verify(citations: list[Citation], sections: list[Section]) -> VerificationResult:
    """Check citations against the sections supplied to the model.

    Deliberately checks against the *supplied* sections rather than the whole
    corpus. A quote that happens to appear somewhere the model never saw is not
    evidence the model used it — accepting that would verify a coincidence.
    """

    by_key: dict[tuple[str, str], Section] = {(s.doc, s.heading): s for s in sections}
    known_docs = {section.doc for section in sections}

    verified: list[VerifiedCitation] = []
    rejected: list[tuple[Citation, str]] = []

    for citation in citations:
        section = by_key.get((citation.doc, citation.heading))

        if section is None:
            reason = (
                "unknown_document"
                if citation.doc not in known_docs
                else "heading_not_supplied"
            )
            rejected.append((citation, reason))
            continue

        if not citation.quote.strip():
            rejected.append((citation, "empty_quote"))
            continue

        if not section.contains_quote(citation.quote):
            rejected.append((citation, "quote_not_found"))
            continue

        verified.append(
            VerifiedCitation(
                doc=section.doc,
                heading=section.heading,
                quote=citation.quote.strip(),
                start_line=section.start_line,
                end_line=section.end_line,
            )
        )

    return VerificationResult(verified=verified, rejected=rejected)


def parse_citations(payload: object) -> list[Citation]:
    """Read citations out of a model's structured response.

    Tolerant of shape, strict about content: a malformed entry is skipped
    rather than raising, because one bad citation should cost its own claim and
    not the whole answer. Anything that survives still faces `verify`.
    """

    if not isinstance(payload, list):
        return []

    citations: list[Citation] = []
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        doc = entry.get("doc")
        heading = entry.get("heading", "")
        quote = entry.get("quote")
        if not isinstance(doc, str) or not isinstance(quote, str):
            continue
        if not isinstance(heading, str):
            heading = ""
        citations.append(Citation(doc=doc, heading=heading, quote=quote))
    return citations
