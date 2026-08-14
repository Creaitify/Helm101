"""Where knowledge documents come from.

`KnowledgeSource` is the seam a pgvector-backed source fills later without the
agent changing. It is `async` and tenant-aware from the start even though the
markdown implementation is neither, because the eventual replacement is an API
call — a worker must never hold a database credential — and retrofitting
`async` through every caller afterwards is the change this avoids.

The corpus served here is HELM's own documentation: shared across tenants,
classified "public/internal operational", and explicitly **not** tenant
personal data. The `tenant_id` argument is carried so the pgvector version can
scope its rows; the markdown version ignores it, and the API contract says so
plainly rather than letting a reader assume citations point at tenant data.
"""

from __future__ import annotations

import fnmatch
import os
from pathlib import Path
from typing import Protocol
from uuid import UUID

from app.knowledge.sections import Section, digest, parse_sections

# Anything that is not documentation. Dependency trees would otherwise drown
# the corpus in third-party READMEs, and tool caches quietly inject files that
# look like documentation but are build artefacts — `.pytest_cache/README.md`
# is a real example that reached the corpus before this list caught it.
# A stray document here is not cosmetic: it becomes citable, so the agent can
# ground an answer about HELM in a dependency's README.
_EXCLUDED_DIRECTORIES = frozenset(
    {
        ".git",
        ".next",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".venv",
        "__pycache__",
        "build",
        "dist",
        "node_modules",
        "site-packages",
    }
)


class KnowledgeSource(Protocol):
    """A corpus the Analyst can reason over."""

    async def sections(self, *, tenant_id: UUID | None = None) -> list[Section]:
        """Every section available to this caller."""
        ...

    async def digest(self, *, tenant_id: UUID | None = None) -> str:
        """A fingerprint of the corpus state, for reproducibility."""
        ...


class MarkdownFileSource:
    """Serves the repository's own markdown as the knowledge corpus.

    Reads eagerly and caches. The corpus is small and changes only when someone
    edits a document, so re-reading twenty files per question would buy nothing
    but latency. `refresh()` exists for the tests and for a future file watcher.
    """

    source_name = "platform_docs"
    tenant_scoped = False

    def __init__(self, root: Path, *, pattern: str = "*.md") -> None:
        self._root = root
        self._pattern = pattern
        self._cache: list[Section] | None = None

    def refresh(self) -> None:
        self._cache = None

    async def sections(self, *, tenant_id: UUID | None = None) -> list[Section]:
        if self._cache is None:
            self._cache = self._load()
        return list(self._cache)

    async def digest(self, *, tenant_id: UUID | None = None) -> str:
        return digest(await self.sections(tenant_id=tenant_id))

    def documents(self) -> list[str]:
        paths = sorted(self._discover(), key=lambda path: path.as_posix())
        return [path.relative_to(self._root).as_posix() for path in paths]

    def _load(self) -> list[Section]:
        sections: list[Section] = []
        for path in sorted(self._discover(), key=lambda item: item.as_posix()):
            doc = path.relative_to(self._root).as_posix()
            # `errors="replace"` rather than a raise: one document with an odd
            # byte should degrade that document, not take down the whole corpus
            # and with it every answer.
            content = path.read_text(encoding="utf-8", errors="replace")
            sections.extend(parse_sections(doc, content))
        return sections

    def _discover(self) -> list[Path]:
        if not self._root.is_dir():
            return []
        found: list[Path] = []
        for dirpath, dirnames, filenames in os.walk(self._root):
            # Prune excluded directories in-place so os.walk does not descend into them
            dirnames[:] = [d for d in dirnames if d not in _EXCLUDED_DIRECTORIES]
            for filename in filenames:
                if fnmatch.fnmatch(filename, self._pattern):
                    found.append(Path(dirpath) / filename)
        return found
