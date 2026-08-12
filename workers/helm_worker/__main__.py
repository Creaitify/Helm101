"""Drive an Analyst run from the command line.

Three commands, deliberately separate processes, because that is the property
worth demonstrating:

    python -m helm_worker ask "what blocks live sign-in?"
    python -m helm_worker pending
    python -m helm_worker decide <run-id> --approve

Between `ask` and `decide` the worker can be killed, rebooted or redeployed. The
run is held in the checkpoint file, not in memory, so `decide` picks it up in a
process that never saw it start — and the model is not called a second time.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from helm_worker.checkpoint import open_checkpointer
from helm_worker.config import WorkerSettings
from helm_worker.gateway_client import GatewayCallFailed, GatewayClient
from helm_worker.logging import configure_logging
from helm_worker.runtime import AnalystRuntime, RunHandle


def _print_handle(handle: RunHandle) -> None:
    print(f"run      {handle.run_id}")
    print(f"status   {handle.status}")

    if handle.is_awaiting_approval and handle.interrupt_payload is not None:
        proposal = handle.interrupt_payload
        print("\nAwaiting your decision:")
        print(f"  action    {proposal.get('action')}")
        print(f"  grounded  {proposal.get('grounded')}  ({proposal.get('citation_count')} verified citations)")
        print(f"  summary   {proposal.get('summary')}")
        print(f"\n  python -m helm_worker decide {handle.run_id} --approve")
        print(f"  python -m helm_worker decide {handle.run_id} --reject --reason '...'")
        return

    answer = handle.state.get("answer", "")
    if answer:
        print(f"\n{answer}\n")
    for citation in handle.state.get("citations", []):
        print(f"  - {citation.get('doc')}:{citation.get('start_line')} § {citation.get('heading')}")
    for entry in handle.state.get("execution_log", []):
        print(f"  [executed] {entry}")
    if handle.state.get("error_code"):
        print(f"  [error] {handle.state['error_code']}")
    print(f"\n[model calls] {handle.state.get('model_calls', 0)}")


async def _run(args: argparse.Namespace) -> int:
    settings = WorkerSettings()
    configure_logging(settings.log_level)
    # Fails closed if a provider key is present: a worker holding one would
    # make the gateway optional, which is the guarantee this design rests on.
    settings.assert_no_provider_credentials()

    gateway = GatewayClient(settings.helm_api_base_url, timeout_seconds=settings.request_timeout_seconds)
    try:
        async with open_checkpointer(settings.checkpoint_path) as checkpointer:
            runtime = AnalystRuntime(gateway=gateway, checkpointer=checkpointer)

            if args.command == "ask":
                handle = await runtime.start(args.question, run_id=args.run_id)
            elif args.command == "decide":
                decision = "approved" if args.approve else "rejected"
                handle = await runtime.resume(args.run_id, decision=decision, reason=args.reason or "")
            else:
                handle = await runtime.inspect(args.run_id)

            _print_handle(handle)
            return 0
    except GatewayCallFailed as error:
        print(f"[gateway] {error.code}: {error}", file=sys.stderr)
        print("Is the API running?  cd api && ./.venv/Scripts/uvicorn app.main:app --port 8000", file=sys.stderr)
        return 2
    finally:
        await gateway.aclose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="helm_worker", description="HELM's durable Analyst agent runtime.")
    commands = parser.add_subparsers(dest="command", required=True)

    ask = commands.add_parser("ask", help="Start a run; it pauses for your approval.")
    ask.add_argument("question")
    ask.add_argument("--run-id", default=None, help="Reuse a specific run id.")

    decide = commands.add_parser("decide", help="Approve or reject a paused run.")
    decide.add_argument("run_id")
    group = decide.add_mutually_exclusive_group(required=True)
    group.add_argument("--approve", action="store_true")
    group.add_argument("--reject", action="store_true")
    decide.add_argument("--reason", default="")

    status = commands.add_parser("status", help="Show a run's current position.")
    status.add_argument("run_id")

    return asyncio.run(_run(parser.parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
