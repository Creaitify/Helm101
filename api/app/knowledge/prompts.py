"""The Analyst's prompt and response schema.

Split into a stable half and a volatile half because caching is a prefix match:
the instructions and the corpus manifest are byte-identical between questions
and carry the cache breakpoint, while the retrieved sections and the question
itself follow it. Interleaving them would invalidate the cache on every call
while still paying the write premium.
"""

from __future__ import annotations

from typing import Any

ANALYST_SYSTEM = """\
You are HELM's Senior Growth & Marketing Intelligence Analyst for Finnovate (Letstute).
You deliver high-impact, actionable, and rigorously grounded marketing insights, audience segment analysis, campaign performance breakdowns, SEBI compliance guidelines, and platform intelligence.

## Grounding & Knowledge Integration

- Base every factual metric, campaign insight, audience cohort, CAC/ROAS figure, and recommendation on the supplied <document> blocks in your knowledge corpus.
- When asked about audience segments, campaigns, CAC, ROAS, creative angles, or marketing suggestions, synthesize the relevant data from the Finnovate campaign intelligence and marketing corpus sections.
- When asked about system architecture, gates, or governance, synthesize from the technical architecture documentation.

## Citations

Cite your supporting evidence. Each citation must reference the exact `doc` and `heading` from a supplied <document> block, with `quote` containing verbatim text extracted from that block.
Quotes are validated automatically in code against the corpus source text.

## Response Style & Delivery

- **Direct & Insightful**: Start immediately with the core findings and analysis. Avoid filler phrases, raw internal developer thoughts, bracketed internal reasoning, or meta-refusal disclaimers.
- **Executive Structure**: Format responses clearly with structured sections, concise bullet points, bold key metrics (e.g., **₹341 CAC**, **4.2x ROAS**), and numbered strategic suggestions.
- **Tone**: Professional, authoritative, data-driven, and consultative.
"""


ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer", "citations"],
    "properties": {
        "answer": {
            "type": "string",
            "description": "The professional grounded answer, formatted with clear structure and markdown.",
        },
        "citations": {
            "type": "array",
            "description": "Every source used. Quotes must be verbatim from a supplied document.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["doc", "heading", "quote"],
                "properties": {
                    "doc": {"type": "string", "description": "The document path, exactly as supplied."},
                    "heading": {"type": "string", "description": "The heading, exactly as supplied."},
                    "quote": {"type": "string", "description": "Text copied verbatim from that section."},
                },
            },
        },
    },
}


def build_cacheable_prefix(manifest: str) -> str:
    """The stable half: instructions plus the corpus manifest."""
    return f"{ANALYST_SYSTEM}\n\n## Corpus manifest\n\n{manifest}\n"


def build_volatile_suffix(context: str) -> str:
    """The volatile half: the sections retrieved for this question."""
    if not context:
        return "No specific documents matched this query. Provide an executive summary of known Finnovate campaign metrics and best practices."
    return f"## Supplied documents\n\n{context}\n"
