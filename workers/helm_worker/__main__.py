"""Drive HELM's agent roster and Governor Star Topology relay from the command line.

One verb per agent or full relay, one shared pair to decide and inspect:

    python -m helm_worker govern "raise checkups 10% this month" # Star Topology Relay
    python -m helm_worker ask "what blocks live sign-in?"        # Analyst
    python -m helm_worker buy --objective "lower blended CAC"    # Media Buyer
    python -m helm_worker create "Diwali FHC push for parents"   # Creative
    python -m helm_worker decide <run-id> --approve
    python -m helm_worker status <run-id>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

import httpx

from helm_worker.agents.creative import build_creative_graph
from helm_worker.agents.governor import build_governor_graph
from helm_worker.agents.media_buyer import build_media_buyer_graph
from helm_worker.data_sources import resolve_campaigns
from helm_worker.checkpoint import open_checkpointer
from helm_worker.config import WorkerSettings
from helm_worker.gateway_client import GatewayCallFailed, GatewayClient
from helm_worker.logging import configure_logging
from helm_worker.runtime import AgentRuntime, AnalystRuntime, RunHandle


def _handle_to_dict(handle: RunHandle) -> dict[str, Any]:
    return {
        "run_id": handle.run_id,
        "status": handle.status,
        "is_awaiting_approval": handle.is_awaiting_approval,
        "interrupt_payload": handle.interrupt_payload,
        "state": handle.state,
    }


def _print_handle(handle: RunHandle) -> None:
    sep = "=" * 70
    sub_sep = "-" * 70

    print(f"\n{sep}")
    print(f"  HELM AGENT RUNTIME · RUN: {handle.run_id}")
    status_label = handle.status.upper()
    if handle.is_awaiting_approval:
        status_label = "AWAITING HUMAN APPROVAL (PAUSED AT HITL GATE)"
    print(f"  STATUS: {status_label}")
    print(f"{sep}")

    state = handle.state
    hops = state.get("hops", [])
    if hops:
        print(f"\n[STAR TOPOLOGY RELAY TIMELINE: {len(hops)} HOPS]")
        for hop in hops:
            idx = hop.get("hop_index", 0)
            from_a = hop.get("from_agent", "?").upper()
            to_a = hop.get("to_agent", "?").upper()
            kind = hop.get("hop_kind", "")
            verdict = hop.get("verdict", "").upper()
            summary = hop.get("summary", "")
            rationale = hop.get("governor_rationale", "")
            print(f"  #{idx} [{from_a} -> {to_a}] ({kind}) [{verdict}]")
            if summary:
                print(f"     Summary: {summary}")
            if rationale:
                print(f"     Rationale: {rationale}")

    # Analyst answer & citations
    answer = state.get("answer", "")
    citations = state.get("citations", [])
    if answer:
        print(f"\n[ANALYST AUDIT FINDINGS]\n  {answer}")
    if citations:
        print("\n  Citations & Sources:")
        for c in citations:
            doc = c.get("doc") or c.get("source") or "platform_corpus"
            line = c.get("start_line", "")
            heading = c.get("heading") or c.get("label", "")
            print(f"    • {doc}{f':{line}' if line else ''} § {heading}")

    # Creative copy variants
    variants = state.get("variants", [])
    verdicts = state.get("verdicts", [])
    if variants:
        print(f"\n[CREATIVE DECK: {len(variants)} VARIANTS]")
        for idx, (v, verd) in enumerate(zip(variants, verdicts if verdicts else [{}] * len(variants), strict=False), 1):
            status = (verd.get("status") or "pass").upper()
            matched = f" (Rule match: {verd.get('matched')})" if verd.get("matched") else ""
            print(f"  Variant {idx} [{status}]: {v.get('headline', '')}")
            print(f"    Body: {v.get('body', '')}{matched}")

    # Media Buyer shifts
    shifts = state.get("shifts", [])
    if shifts:
        print(f"\n[MEDIA BUYER BUDGET REALLOCATION: {len(shifts)} SHIFTS (±25% POLICY)]")
        for s in shifts:
            cid = s.get("campaign_id", "")
            curr = int(float(s.get("current_budget", 0)))
            prop = int(float(s.get("proposed_budget", 0)))
            diff = prop - curr
            diff_str = f"+₹{diff:,}" if diff > 0 else f"-₹{abs(diff):,}"
            print(f"  • {cid:24} ₹{curr:,} -> ₹{prop:,} ({diff_str}) | {s.get('reason', '')}")

    # Execution logs if completed / rejected
    exec_log = state.get("execution_log", [])
    if exec_log:
        print("\n[EXECUTION LOG]")
        for entry in exec_log:
            print(f"  ✓ {entry}")

    # HITL Gate interrupt prompt
    if handle.is_awaiting_approval and handle.interrupt_payload is not None:
        proposal = handle.interrupt_payload
        print(f"\n{sub_sep}")
        print("  HUMAN OPERATOR AUTHORIZATION REQUIRED")
        print(f"{sub_sep}")
        if proposal.get("summary"):
            print(f"  Summary : {proposal['summary']}")
        if proposal.get("action"):
            print(f"  Action  : {proposal['action']}")
        if proposal.get("checks"):
            print("  Checks  : " + " | ".join(f"[{c.get('label')}: {c.get('status', '').upper()}]" for c in proposal["checks"]))

        print(f"\n  To authorize or reject this run:")
        print(f"    Approve: python -m helm_worker decide {handle.run_id} --approve")
        print(f"    Reject : python -m helm_worker decide {handle.run_id} --reject --reason \"<optional reason>\"")

    print(f"{sep}\n")


async def _run(args: argparse.Namespace) -> int:
    settings = WorkerSettings()
    is_json = getattr(args, "json", False)
    configure_logging(level=settings.log_level, json_logs=is_json)
    settings.assert_no_provider_credentials()

    gateway = GatewayClient(
        settings.helm_api_base_url,
        auth_token=settings.auth_token,
        timeout_seconds=settings.request_timeout_seconds,
    )
    try:
        async with open_checkpointer(settings.checkpoint_path) as checkpointer:
            analyst = AnalystRuntime(gateway=gateway, checkpointer=checkpointer)
            media_buyer = AgentRuntime(
                graph=build_media_buyer_graph(gateway), checkpointer=checkpointer, prefix="mb"
            )
            creative = AgentRuntime(graph=build_creative_graph(gateway), checkpointer=checkpointer, prefix="cr")

            async def step_recorder(envelope: dict[str, Any]) -> None:
                """Record step envelope to FastAPI backend for audit and UI inspection."""
                run_id = envelope.get("run_id")
                if not run_id:
                    return
                url = f"{settings.helm_api_base_url}/api/v1/agents/runs/{run_id}/steps"
                body = {
                    "hop_index": envelope.get("hop_index", 0),
                    "from_agent": envelope.get("from_agent", ""),
                    "to_agent": envelope.get("to_agent", ""),
                    "hop_kind": str(envelope.get("hop_kind", "")),
                    "payload": envelope.get("payload", {}),
                    "governor_rationale": envelope.get("governor_rationale", ""),
                    "verdict": envelope.get("verdict", ""),
                    "tokens_in": envelope.get("tokens_in", 0),
                    "tokens_out": envelope.get("tokens_out", 0),
                    "cost_micros": envelope.get("estimated_cost_micros", 0),
                }
                headers = {"Content-Type": "application/json", "X-HELM-Active-Tenant": envelope.get("tenant_id", "letstute")}
                if settings.auth_token:
                    headers["Authorization"] = f"Bearer {settings.auth_token}"
                try:
                    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=0.5, read=1.0, write=1.0, pool=1.0)) as client:
                        await client.post(url, json=body, headers=headers)
                except Exception:
                    pass  # fail soft on network step logging

            governor = AgentRuntime(
                graph=build_governor_graph(gateway, step_recorder=step_recorder),
                checkpointer=checkpointer,
                prefix="gv",
            )

            def runtime_for(run_id: str) -> AgentRuntime:
                prefix = run_id.split("-", 1)[0]
                by_prefix: dict[str, AgentRuntime] = {
                    "mb": media_buyer,
                    "cr": creative,
                    "gv": governor,
                    "an": analyst,
                }
                return by_prefix.get(prefix, analyst)

            if args.command == "pending":
                thread_ids: list[str] = []
                async for checkpoint in checkpointer.alist(None, limit=100):
                    cfg = checkpoint.config if hasattr(checkpoint, "config") else {}
                    configurable = cfg.get("configurable", {}) if isinstance(cfg, dict) else {}
                    thread_id = configurable.get("thread_id")
                    if thread_id and thread_id not in thread_ids:
                        thread_ids.append(thread_id)

                pending_handles: list[RunHandle] = []
                for thread_id in thread_ids:
                    try:
                        handle = await runtime_for(thread_id).inspect(thread_id)
                        if handle.is_awaiting_approval or handle.status == "awaiting_approval":
                            pending_handles.append(handle)
                    except Exception:
                        continue

                if getattr(args, "json", False):
                    print(json.dumps([_handle_to_dict(h) for h in pending_handles]))
                else:
                    print(f"Found {len(pending_handles)} pending run(s) awaiting approval:")
                    for h in pending_handles:
                        print(f"\n--- {h.run_id} ({h.status}) ---")
                        _print_handle(h)
                return 0

            handle: RunHandle
            if args.command == "ask":
                handle = await analyst.start(args.question, run_id=args.run_id)
            elif args.command == "buy":
                snapshot = resolve_campaigns(run_id=args.run_id or "mb-adhoc")
                initial: dict[str, Any] = {
                    "objective": args.objective,
                    "campaigns": snapshot.campaigns,
                    "data_label": snapshot.label,
                }
                if not getattr(args, "json", False):
                    if snapshot.mode == "live":
                        print(f"[data] {snapshot.label} — live ad account data")
                    else:
                        print(f"[data] {snapshot.label} — synthetic session data, not a live ad account")
                    for note in snapshot.notes:
                        print(f"[data] note: {note}")
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

            if getattr(args, "json", False):
                print(json.dumps(_handle_to_dict(handle)))
            else:
                _print_handle(handle)
            return 0
    except GatewayCallFailed as error:
        if getattr(args, "json", False):
            print(json.dumps({"error": error.code, "message": str(error)}), file=sys.stderr)
        else:
            print(f"[gateway] {error.code}: {error}", file=sys.stderr)
        return 2
    finally:
        await gateway.aclose()


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    json_parent = argparse.ArgumentParser(add_help=False)
    json_parent.add_argument("--json", action="store_true", help="Output results as JSON")

    parser = argparse.ArgumentParser(
        prog="helm_worker", description="HELM's durable agent runtime.", parents=[json_parent]
    )
    commands = parser.add_subparsers(dest="command", required=True)

    ask = commands.add_parser("ask", help="Analyst: answer a question; pauses for your approval.", parents=[json_parent])
    ask.add_argument("question")
    ask.add_argument("--run-id", default=None, help="Reuse a specific run id.")

    buy = commands.add_parser(
        "buy", help="Media Buyer: propose budget shifts on the sample campaigns.", parents=[json_parent]
    )
    buy.add_argument("--objective", default="lower blended CAC without losing checkup volume")
    buy.add_argument("--run-id", default=None)

    create = commands.add_parser(
        "create", help="Creative: draft three compliance-checked copy variants.", parents=[json_parent]
    )
    create.add_argument("brief")
    create.add_argument("--run-id", default=None)

    govern = commands.add_parser("govern", help="Governor Star Topology Relay: orchestrates AN -> GV -> CR -> GV -> MB -> GV -> HITL.", parents=[json_parent])
    govern.add_argument("objective")
    govern.add_argument("--run-id", default=None)

    decide = commands.add_parser("decide", help="Approve or reject a paused run (any agent).", parents=[json_parent])
    decide.add_argument("run_id")
    group = decide.add_mutually_exclusive_group(required=True)
    group.add_argument("--approve", action="store_true")
    group.add_argument("--reject", action="store_true")
    decide.add_argument("--reason", default="")

    status = commands.add_parser("status", help="Show a run's current position (any agent).", parents=[json_parent])
    status.add_argument("run_id")

    commands.add_parser("pending", help="List all runs currently awaiting approval.", parents=[json_parent])

    return asyncio.run(_run(parser.parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
