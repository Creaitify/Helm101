"""Knowledge layer: section parsing, retrieval, and citation verification.

The negative citation tests are the important ones. A verifier that only
accepts good citations proves nothing — it would pass just as happily if it
accepted everything. Each rejection case below names the fabrication it catches.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from app.knowledge.citations import Citation, parse_citations, verify
from app.knowledge.corpus import Corpus, render_context, tokenize
from app.knowledge.sections import Section, digest, parse_sections
from app.knowledge.sources import MarkdownFileSource

DOC = """\
Intro text before any heading.

# Setup

Install Python 3.13 or newer.

## Database

The connection string must authenticate as `helm_app`, never a BYPASSRLS role.

# Deployment

Deploy behind Cloudflare.
"""


def _sections() -> list[Section]:
    return parse_sections("docs/example.md", DOC)


def test_parsing_splits_on_headings_and_keeps_the_preamble() -> None:
    sections = _sections()

    assert [s.heading for s in sections] == ["", "Setup", "Database", "Deployment"]
    # Content before the first heading stays citable rather than disappearing.
    assert sections[0].text == "Intro text before any heading."


def test_line_ranges_are_one_based_and_point_at_the_heading() -> None:
    """A citation should be followable by hand in an editor."""

    sections = _sections()
    setup = next(s for s in sections if s.heading == "Setup")

    lines = DOC.splitlines()
    assert lines[setup.start_line - 1] == "# Setup"
    assert "Install Python 3.13" in setup.text


def test_a_hash_inside_a_code_fence_is_not_a_heading() -> None:
    """Splitting on a shell comment would invent a section that does not exist.

    The mutation that turns this red is dropping the fence tracking from
    `parse_sections`.
    """

    content = "# Real\n\n```bash\n# Not a heading\necho hi\n```\n\n# Also real\n"
    headings = [section.heading for section in parse_sections("d.md", content)]

    assert headings == ["Real", "Also real"]


def test_a_section_runs_until_the_next_heading_of_any_level() -> None:
    sections = _sections()
    setup = next(s for s in sections if s.heading == "Setup")

    # "Database" is a deeper heading, so it ends "Setup" rather than nesting
    # inside it. Each heading owns exactly its own body.
    assert "helm_app" not in setup.text


def test_the_digest_changes_when_content_changes() -> None:
    """A run records the corpus state that produced its answer.

    Without this, "the agent said X" is unfalsifiable once the docs move on.
    """

    original = digest(_sections())
    edited = digest(parse_sections("docs/example.md", DOC.replace("Cloudflare", "a CDN")))

    assert original != edited
    assert digest(_sections()) == original


def test_search_ranks_the_relevant_section_first() -> None:
    corpus = Corpus(_sections())

    results = corpus.search("which role should the database connection use?")

    assert results
    assert results[0].section.heading == "Database"


def test_search_returns_nothing_for_an_unrelated_question() -> None:
    """A miss must be visible, not a low-scoring near-match.

    Returning something for every question is how a grounded agent starts
    answering from the wrong section with full confidence.
    """

    corpus = Corpus(_sections())

    assert corpus.search("what is the airspeed velocity of a swallow") == []


def test_selection_respects_its_token_budget() -> None:
    corpus = Corpus(_sections())

    selected = corpus.select("database setup deployment", token_budget=1)

    # Nothing fits in a one-token budget, and a partial section is never
    # returned — truncating would break the citation it carries.
    assert selected == []


def test_the_manifest_lists_every_heading() -> None:
    """The manifest is what separates 'not covered' from 'not retrieved'."""

    manifest = Corpus(_sections()).manifest()

    for heading in ("Setup", "Database", "Deployment"):
        assert heading in manifest
    assert "docs/example.md" in manifest


def test_rendered_context_carries_the_citation_anchor() -> None:
    rendered = render_context(_sections()[1:2])

    assert 'path="docs/example.md"' in rendered
    assert 'heading="Setup"' in rendered
    assert "lines=" in rendered


def test_tokenize_drops_terms_that_discriminate_nothing() -> None:
    """"helm" matches every document in a corpus about HELM."""

    assert "helm" not in tokenize("How does HELM handle the database?")
    assert "database" in tokenize("How does HELM handle the database?")


# --- Citation verification -------------------------------------------------


def test_a_real_quote_from_a_supplied_section_verifies() -> None:
    sections = _sections()
    citation = Citation(doc="docs/example.md", heading="Database", quote="never a BYPASSRLS role")

    result = verify([citation], sections)

    assert result.is_grounded
    assert result.rejected == []
    (verified,) = result.verified
    assert verified.doc == "docs/example.md"
    assert verified.start_line > 0


def test_a_citation_naming_a_document_that_does_not_exist_is_rejected() -> None:
    """The clearest fabrication: a plausible path that was never supplied."""

    citation = Citation(doc="docs/nonexistent.md", heading="Setup", quote="Install Python")

    result = verify([citation], _sections())

    assert result.verified == []
    assert result.rejected[0][1] == "unknown_document"
    assert not result.is_grounded


def test_a_fabricated_quote_from_a_real_document_is_rejected() -> None:
    """The dangerous fabrication: right document, invented sentence.

    This is the case a verifier that only checks the path would wave through,
    and the one a reader is least able to catch. The mutation that turns this
    red is dropping the `contains_quote` check from `verify`.
    """

    citation = Citation(
        doc="docs/example.md",
        heading="Database",
        quote="The connection string may authenticate as a superuser.",
    )

    result = verify([citation], _sections())

    assert result.verified == []
    assert result.rejected[0][1] == "quote_not_found"


def test_a_citation_naming_a_heading_that_was_not_supplied_is_rejected() -> None:
    """Verification runs against what the model actually saw.

    A quote that happens to exist somewhere the model was never shown is not
    evidence it used that section — accepting it would verify a coincidence.
    """

    supplied = [s for s in _sections() if s.heading == "Setup"]
    citation = Citation(doc="docs/example.md", heading="Database", quote="never a BYPASSRLS role")

    result = verify([citation], supplied)

    assert result.verified == []
    assert result.rejected[0][1] == "heading_not_supplied"


def test_an_empty_quote_is_rejected() -> None:
    citation = Citation(doc="docs/example.md", heading="Setup", quote="   ")

    result = verify([citation], _sections())

    assert result.rejected[0][1] == "empty_quote"


def test_a_quote_reflowed_across_lines_still_verifies() -> None:
    """Whitespace differences are formatting, not fabrication."""

    citation = Citation(
        doc="docs/example.md",
        heading="Database",
        quote="must authenticate as\n  `helm_app`,   never",
    )

    result = verify([citation], _sections())

    assert result.is_grounded


def test_a_paraphrase_does_not_verify() -> None:
    """Only whitespace is normalised. Rewording is a fabricated quotation."""

    citation = Citation(
        doc="docs/example.md",
        heading="Database",
        quote="must authenticate as helm_app and never as a BYPASSRLS role",
    )

    result = verify([citation], _sections())

    assert result.verified == []


def test_parsing_a_malformed_citation_skips_it_rather_than_raising() -> None:
    """One bad citation costs its own claim, not the whole answer."""

    parsed = parse_citations(
        [
            {"doc": "a.md", "heading": "H", "quote": "q"},
            {"doc": 42, "quote": "q"},
            "not an object",
            {"heading": "H"},
        ]
    )

    assert len(parsed) == 1
    assert parsed[0].doc == "a.md"


def test_parsing_a_non_list_payload_yields_nothing() -> None:
    assert parse_citations({"doc": "a.md"}) == []
    assert parse_citations(None) == []


# --- Source loading --------------------------------------------------------


def test_the_markdown_source_reads_the_repository_corpus(tmp_path: Path) -> None:
    (tmp_path / "docs").mkdir()
    (tmp_path / "README.md").write_text("# Root\n\nHello.\n", encoding="utf-8")
    (tmp_path / "docs" / "guide.md").write_text("# Guide\n\nBody.\n", encoding="utf-8")

    source = MarkdownFileSource(tmp_path)

    assert source.documents() == ["README.md", "docs/guide.md"]


@pytest.mark.parametrize("excluded", ["node_modules", ".pytest_cache", ".venv", "__pycache__"])
def test_the_markdown_source_skips_dependency_and_cache_directories(tmp_path: Path, excluded: str) -> None:
    """Build artefacts and dependencies must never become citable.

    `.pytest_cache/README.md` really did reach the corpus before this list
    caught it. A stray document here is not cosmetic — it lets the agent ground
    an answer about HELM in a tool's cache file.
    """

    (tmp_path / excluded / "pkg").mkdir(parents=True)
    (tmp_path / excluded / "pkg" / "README.md").write_text("# Not ours\n", encoding="utf-8")
    (tmp_path / "README.md").write_text("# Root\n", encoding="utf-8")

    assert MarkdownFileSource(tmp_path).documents() == ["README.md"]


def test_the_document_path_contributes_to_ranking() -> None:
    """People refer to documents by name — "what did *the audit* say".

    Without the path in the indexed text, a question naming a document ranks it
    no higher than any other.
    """

    sections = parse_sections("docs/reports/cleanup_audit.md", "# Findings\n\nSomething was wrong.\n")
    sections += parse_sections("docs/other.md", "# Findings\n\nSomething was wrong.\n")

    top = Corpus(sections).search("what did the audit find?")[0]

    assert top.section.doc == "docs/reports/cleanup_audit.md"


async def test_the_markdown_source_reports_it_is_not_tenant_scoped() -> None:
    """The corpus is platform documentation shared across tenants.

    Stated explicitly so a future reader does not assume citations point at
    tenant data and build on a false premise.
    """

    source = MarkdownFileSource(Path("."))

    assert source.tenant_scoped is False
    assert source.source_name == "platform_docs"


async def test_a_missing_root_yields_an_empty_corpus_rather_than_raising(tmp_path: Path) -> None:
    source = MarkdownFileSource(tmp_path / "does-not-exist")

    assert await source.sections() == []


@pytest.mark.parametrize("question", ["", "   ", "the a of"])
def test_an_empty_or_stopword_only_question_matches_nothing(question: str) -> None:
    assert Corpus(_sections()).search(question) == []


def test_the_overview_takes_each_documents_leading_section() -> None:
    """The fallback for questions retrieval cannot score ("what is HELM?").

    A document's first section is its own introduction, so the set of first
    sections is the corpus's answer to "describe this platform".
    """

    sections = _sections() + parse_sections("docs/other.md", "# Other\n\nAnother document.\n")

    overview = Corpus(sections).overview()

    assert [(s.doc, s.heading) for s in overview] == [("docs/example.md", ""), ("docs/other.md", "Other")]


def test_the_overview_skips_a_section_that_exceeds_the_budget_whole() -> None:
    big = parse_sections("docs/big.md", "# Big\n\n" + "x" * 200 + "\n")
    small = parse_sections("docs/small.md", "# Small\n\nFits.\n")

    # Budget below the big section's cost: it is skipped entirely (a truncated
    # section could not verify its citations), the small one still selected.
    overview = Corpus(big + small).overview(token_budget=20)

    assert [s.doc for s in overview] == ["docs/small.md"]
