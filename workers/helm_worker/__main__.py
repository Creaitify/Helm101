"""Drive HELM's agent roster from the command line.

One verb per agent to start a run, one shared pair to decide and inspect:

    python -m helm_worker ask "what blocks live sign-in?"        # Analyst
    python -m helm_worker buy --objective "lower blended CAC"    # Media Buyer
    python -m helm_worker create "Diwali FHC push for parents"   # Creative
    python -m helm_worker govern "raise checkups 10% this month" # Governor
    python -m helm_worker decide <run-id> --approve
    python -m helm_worker status <run-id>

Run ids carry their agent as a prefix (an-, mb-, cr-, gv-), so `decide` and
`status` route on the id alone. Between starting and deciding, the worker can
be killed, rebooted or redeployed: the run lives in the checkpoint file, and
the model is not called a second time on resume.

The Governor's `decide --approve` dispatches its approved delegations as
child runs — each of which pauses at its OWN approval gate and is decided
with the same `decide` verb.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any

from helm_worker.agents.creative import build_creative_graph
from helm_worker.agents.governor import build_governor_graph
from helm_worker.agents.media_buyer import build_media_buyer_graph
from helm_worker.agents.media_buyer.data import SAMPLE_CAMPAIGNS, SAMPLE_LABEL
from helm_worker.checkpoint import open_checkpointer
from helm_worker.config import WorkerSettings
from helm_worker.gateway_client import GatewayCallFailed, GatewayClient
from helm_worker.logging import configure_logging
from helm_worker.runtime import AgentRuntime, AnalystRuntime, RunHandle


def _print_handle(handle: RunHandle) -> None:
    print(f"run      {handle.run_id}")
    print(f"status   {handle.status}")

    if handle.is_awaiting_approval and handle.interrupt_payload is not None:
        proposal = handle.interrupt_payload
        print("\nAwaiting your decision:")
        for key, value in proposal.items():
            if key in {"run_id", "interrupt_id"}:
                continue
            print(f"  {key:12}{value}")
        print(f"\n  python -m helm_worker decide {handle.run_id} --approve")
        print(f"  python -m helm_worker decide {handle.run_id} --reject --reason '...'")
        return

    state = handle.state
    answer = state.get("answer", "")
    if answer:
        print(f"\n{answer}\n")
    for citation in state.get("citations", []):
        print(f"  - {citation.get('doc')}:{citation.get('start_line')} § {citation.get('heading')}")
    if state.get("analysis"):
        print(f"\n{state['analysis']}\n")
    for shift in state.get("shifts", []):
        # ASCII arrow: Windows consoles default to cp1252, which cannot
        # encode U+2192 — a run must never look failed because of a glyph.
        print(
            f"  [shift] {shift.get('campaign_id')}: "
            f"{int(float(shift.get('current_budget', 0)))} -> {int(float(shift.get('proposed_budget', 0)))}"
            f"  ({shift.get('reason', '')})"
        )
    for note in state.get("policy_notes", []) + state.get("validation_notes", []):
        print(f"  [policy] {note}")
    for variant, verdict in zip(state.get("variants", []), state.get("verdicts", []), strict=False):
        matched = f" matched={verdict.get('matched')}" if verdict.get("matched") else ""
        print(f"  [{verdict.get('status', '?'):5}] {variant.get('headline', '')} — {variant.get('body', '')}{matched}")
    if state.get("plan_summary"):
        print(f"\n{state['plan_summary']}\n")
    for child in state.get("children", []):
        print(f"  [child] {child.get('agent')}: {child.get('run_id')}")
    for entry in state.get("execution_log", []):
        print(f"  [executed] {entry}")
    if state.get("error_code"):
        print(f"  [error] {state['error_code']}")
    print(f"\n[model calls] {state.get('model_calls', 0)}")


async def _run(args: argparse.Namespace) -> int:
    settings = WorkerSettings()
    configure_logging(settings.log_level)
    # Fails closed if a provider key is present: a worker holding one would
    # make the gateway optional, which is the guarantee this design rests on.
    settings.assert_no_provider_credentials()

    gateway = GatewayClient(settings.helm_api_base_url, timeout_seconds=settings.request_timeout_seconds)
    try:
        async with open_checkpointer(settings.checkpoint_path) as checkpointer:
            analyst = AnalystRuntime(gateway=gateway, checkpointer=checkpointer)
            media_buyer = AgentRuntime(
                graph=build_media_buyer_graph(gateway), checkpointer=checkpointer, prefix="mb"
            )
            creative = AgentRuntime(graph=build_creative_graph(gateway), checkpointer=checkpointer, prefix="cr")

            async def dispatch(agent: str, task_input: str) -> str:
                """Start a child run for the Governor. It pauses at its own gate."""

                if agent == "analyst":
                    return (await analyst.start(task_input)).run_id
                if agent == "media_buyer":
                    return (
                        await media_buyer.start_with(
                            {
                                "objective": task_input,
                                "campaigns": SAMPLE_CAMPAIGNS,
                                "data_label": SAMPLE_LABEL,
                            }
                        )
                    ).run_id
                if agent == "creative":
                    return (await creative.start_with({"brief": task_input})).run_id
                raise ValueError(f"No runtime for agent {agent!r}")

            governor = AgentRuntime(
                graph=build_governor_graph(gateway, dispatch), checkpointer=checkpointer, prefix="gv"
            )

            def runtime_for(run_id: str) -> AgentRuntime:
                prefix = run_id.split("-", 1)[0]
                by_prefix: dict[str, AgentRuntime] = {
                    "mb": media_buyer,
                    "cr": creative,
                    "gv": governor,
                    "an": analyst,
                }
                # Pre-roster run ids were bare UUIDs from the Analyst.
                return by_prefix.get(prefix, analyst)

            handle: RunHandle
            if args.command == "ask":
                handle = await analyst.start(args.question, run_id=args.run_id)
            elif args.command == "buy":
                initial: dict[str, Any] = {
                    "objective": args.objective,
                    "campaigns": SAMPLE_CAMPAIGNS,
                    "data_label": SAMPLE_LABEL,
                }
                print(f"[data] {SAMPLE_LABEL} — synthetic sample campaigns, not a live ad account")
                handle = await media_buyer.start_with(initial, run_id=args.run_id)
            elif args.command == "create":
                handle = await creative.start_with({"brief": args.brief}, run_id=args.run_id)
            elif args.command == "govern":
                handle = await governor.start_with({"objective": args.objective}, run_id=args.run_id)
            elif args.command == "decide":
                decision = "approved" if args.approve else "rejected"
                handle = await runtime_for(args.run_id).resume(
                    args.run_id, decision=decision, reason=args.reason or ""
                )
            else:
                handle = await runtime_for(args.run_id).inspect(args.run_id)

            _print_handle(handle)
            return 0
    except GatewayCallFailed as error:
        print(f"[gateway] {error.code}: {error}", file=sys.stderr)
        print("Is the API running?  cd api && ./.venv/Scripts/uvicorn app.main:app --port 8000", file=sys.stderr)
        return 2
    finally:
        await gateway.aclose()


def main(argv: list[str] | None = None) -> int:
    # Model output is printed verbatim and can contain any Unicode; Windows
    # consoles default to cp1252, and a completed run must never look failed
    # because a glyph could not be encoded.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(prog="helm_worker", description="HELM's durable agent runtime.")
    commands = parser.add_subparsers(dest="command", required=True)

    ask = commands.add_parser("ask", help="Analyst: answer a question; pauses for your approval.")
    ask.add_argument("question")
    ask.add_argument("--run-id", default=None, help="Reuse a specific run id.")

    buy = commands.add_parser("buy", help="Media Buyer: propose budget shifts on the sample campaigns.")
    buy.add_argument("--objective", default="lower blended CAC without losing checkup volume")
    buy.add_argument("--run-id", default=None)

    create = commands.add_parser("create", help="Creative: draft three compliance-checked copy variants.")
    create.add_argument("brief")
    create.add_argument("--run-id", default=None)

    govern = commands.add_parser("govern", help="Governor: plan delegations across the roster.")
    govern.add_argument("objective")
    govern.add_argument("--run-id", default=None)

    decide = commands.add_parser("decide", help="Approve or reject a paused run (any agent).")
    decide.add_argument("run_id")
    group = decide.add_mutually_exclusive_group(required=True)
    group.add_argument("--approve", action="store_true")
    group.add_argument("--reject", action="store_true")
    decide.add_argument("--reason", default="")

    status = commands.add_parser("status", help="Show a run's current position (any agent).")
    status.add_argument("run_id")

    return asyncio.run(_run(parser.parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
