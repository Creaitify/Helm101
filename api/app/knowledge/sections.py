"""Parse markdown into heading-anchored sections.

Sections, not arbitrary chunks, because **a citation needs an anchor**. You
cannot verify a claim against "the corpus"; you can verify it against a
specific document, heading path and line range. Splitting on headings is
therefore not a retrieval optimisation — it is the mechanism that makes
grounding checkable in code rather than asserted by the model.

Line numbers are 1-based and inclusive, matching what an editor shows, so a
citation can be followed by hand.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

# Setext headings ("Title" underlined with === or ---) are deliberately not
# supported. Every document in this corpus uses ATX headings, and accepting
# both would make a horizontal rule ("---") ambiguous with a heading underline.
_ATX_HEADING = re.compile(r"^(?P<hashes>#{1,6})\s+(?P<title>.+?)\s*#*\s*$")
_FENCE = re.compile(r"^\s*(?P<ticks>`{3,}|~{3,})")


@dataclass(frozen=True, slots=True)
class Section:
    """One heading and the body beneath it, up to the next heading of any level."""

    doc: str
    heading: str
    level: int
    start_line: int
    end_line: int
    text: str

    @property
    def anchor(self) -> str:
        """A stable, human-readable citation target."""

        return f"{self.doc} § {self.heading}" if self.heading else self.doc

    def contains_quote(self, quote: str) -> bool:
        """Whether a quote actually appears in this section.

        Whitespace is normalised on both sides because a model reflowing a
        quotation across lines is a formatting difference, not a fabrication.
        Nothing else is normalised — case and wording must match, or the check
        would accept a paraphrase as a quotation.
        """

        return _normalise(quote) in _normalise(self.text)


def _normalise(value: str) -> str:
    return " ".join(value.split())


def parse_sections(doc: str, content: str) -> list[Section]:
    """Split a markdown document into heading-anchored sections.

    Content appearing before the first heading becomes a section with an empty
    heading, so a document's preamble is still citable rather than invisible.
    """

    lines = content.splitlines()
    boundaries: list[tuple[int, str, int]] = []
    in_fence = False
    fence_marker = ""

    for index, line in enumerate(lines):
        fence = _FENCE.match(line)
        if fence:
            ticks = fence.group("ticks")
            if not in_fence:
                in_fence, fence_marker = True, ticks[0]
            elif ticks[0] == fence_marker:
                in_fence, fence_marker = False, ""
            continue
        if in_fence:
            # A `#` inside a fenced block is a shell comment or a CSS id, not a
            # heading. Treating it as one would split a code sample in half and
            # invent a section that does not exist.
            continue
        heading = _ATX_HEADING.match(line)
        if heading:
            boundaries.append((index, heading.group("title").strip(), len(heading.group("hashes"))))

    sections: list[Section] = []

    if not boundaries or boundaries[0][0] > 0:
        preamble_end = boundaries[0][0] if boundaries else len(lines)
        body = "\n".join(lines[:preamble_end]).strip()
        if body:
            sections.append(
                Section(doc=doc, heading="", level=0, start_line=1, end_line=preamble_end, text=body)
            )

    for position, (line_index, title, level) in enumerate(boundaries):
        end_index = boundaries[position + 1][0] if position + 1 < len(boundaries) else len(lines)
        body = "\n".join(lines[line_index:end_index]).rstrip()
        sections.append(
            Section(
                doc=doc,
                heading=title,
                level=level,
                start_line=line_index + 1,
                end_line=end_index,
                text=body,
            )
        )

    return sections


def digest(sections: list[Section]) -> str:
    """A stable fingerprint of a corpus state.

    Recorded on every run so an answer stays reproducible against the exact
    documents that produced it. Without it, "the agent said X" is unfalsifiable
    once the docs change.
    """

    hasher = hashlib.sha256()
    for section in sorted(sections, key=lambda item: (item.doc, item.start_line)):
        hasher.update(section.doc.encode())
        hasher.update(str(section.start_line).encode())
        hasher.update(section.text.encode())
    return hasher.hexdigest()[:16]
