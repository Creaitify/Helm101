"""Ask the Analyst a question from the command line.

The shortest honest proof that the vertical works: corpus → prompt → gateway →
budget ledger → citation verification, with no worker, queue or browser in the
way.

    python -m app.cli.ask "what is blocking live sign-in?"

Runs against the real provider when `ANTHROPIC_API_KEY` is set. Without a key it
falls back to the replay adapter and says so, so the command still demonstrates
the full path — including that an unverifiable citation is rejected — on a
machine with no credentials.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from uuid import UUID, uuid4

from pydantic import SecretStr

from app.gateway.adapters.base import ProviderAdapter
from app.gateway.adapters.replay import RecordedCompletion, ReplayAdapter
from app.gateway.keys import ProviderKeys
from app.gateway.ledger import InMemoryLedger
from app.gateway.service import GatewayService
from app.knowledge.analyst import AnalystService
from app.knowledge.sources import MarkdownFileSource

DEMO_TENANT = UUID("00000000-0000-0000-0000-0000000000a1")


def _repository_root() -> Path:
    # app/cli/ask.py → app/cli → app → api → repository root
    return Path(__file__).resolve().parents[3]


def _build_adapter(api_key: str | None) -> tuple[ProviderAdapter, bool]:
    if api_key:
        from app.gateway.adapters.anthropic import AnthropicAdapter

        return AnthropicAdapter(ProviderKeys(anthropic_api_key=SecretStr(api_key))), True

    # A fabricated citation, deliberately. It exercises the rejection path, so
    # a keyless run still shows that verification is real rather than assumed.
    canned = (
        '{"answer": "Replay mode: no provider was called. This canned answer '
        'cites a document that does not exist, so citation verification should '
        'reject it.", "citations": [{"doc": "docs/not-a-real-file.md", '
        '"heading": "Nope", "quote": "invented"}]}'
    )
    return ReplayAdapter([RecordedCompletion(text=canned)]), False


async def _run(question: str, root: Path, api_key: str | None) -> int:
    adapter, live = _build_adapter(api_key)
    ledger = InMemoryLedger()
    gateway = GatewayService(adapter=adapter, ledger=ledger)
    analyst = AnalystService(gateway=gateway, source=MarkdownFileSource(root))

    mode = "live provider" if live else "replay adapter (no ANTHROPIC_API_KEY set)"
    print(f"[mode] {mode}")
    print(f"[corpus] {root}")

    try:
        result = await analyst.ask(question, tenant_id=DEMO_TENANT, request_id=str(uuid4()))
    finally:
        await gateway.aclose()

    print(f"[grounded] {result.is_grounded}   [corpus digest] {result.corpus_digest}")
    print(f"[sections supplied] {len(result.sections_supplied)}")
    print()
    print(result.answer)

    if result.citations:
        print("\nCitations (verified against the supplied text):")
        for citation in result.citations:
            print(f"  - {citation.doc}:{citation.start_line} § {citation.heading}")
            print(f'      "{citation.quote[:110]}"')

    if result.rejected:
        print("\nRejected citations (this is the verifier working, not a bug):")
        for doc, reason in result.rejected:
            print(f"  - {doc}: {reason}")

    snapshot = await ledger.snapshot(tenant_id=DEMO_TENANT)
    print(
        f"\n[spend] {snapshot.spent_micros} micro-dollars"
        f"   [cap] {snapshot.cap_micros}"
        f"   [enforcement] {snapshot.enforcement_backend}"
        f" (multi-writer safe: {snapshot.multi_writer_safe})"
    )
    return 0 if result.is_grounded or not live else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ask HELM's Analyst a question about its own documentation.")
    parser.add_argument("question", help="The question to answer.")
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Corpus root. Defaults to the repository root.",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="Provider key. Defaults to ANTHROPIC_API_KEY; omit both to use the replay adapter.",
    )
    args = parser.parse_args(argv)

    import os

    api_key = args.api_key or os.environ.get("ANTHROPIC_API_KEY") or None
    root = args.root or _repository_root()
    return asyncio.run(_run(args.question, root, api_key))


if __name__ == "__main__":
    sys.exit(main())
