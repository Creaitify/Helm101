# workers/ — the agent runtime

HELM's durable agent runtime. The Analyst agent runs here: it researches a
question through the gateway, proposes an action, **pauses for a human
decision**, and resumes from its checkpoint — in a different process if the
worker was restarted in the meantime.

## Try it

The API must be running, because the worker holds no provider key and reaches
models only through it:

```bash
cd api && ./.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```

Then, in another terminal:

```bash
cd workers
./.venv/Scripts/python.exe -m helm_worker ask "what is blocking live sign-in?"
```

The run pauses and prints a run id. **Kill the worker, reboot, come back
tomorrow** — then approve it:

```bash
./.venv/Scripts/python.exe -m helm_worker decide <run-id> --approve
```

The second command runs in a process that never saw the first one. It
reconstructs the run from the checkpoint file and does **not** call the model
again.

## The graph

```
analyze → propose → await_approval ⏸ → execute → finalize
```

Everything about its shape follows from one fact: **LangGraph re-runs an
interrupted node from its beginning on resume.** Code before `interrupt()` runs
a second time.

- `analyze` makes the only model call, in its own node before the interrupt. A
  model call inside the interrupting node would be re-billed on every resume.
- `await_approval` is **pure** — read state, `interrupt()`, return. No HTTP, no
  writes. Re-running it does nothing observable twice.
- `execute` is a **separate node after** the interrupt, guarded by an
  idempotency key checked against recorded state. Side effects live here alone.

The Analyst is deliberately read-only: its "action" is persisting its own
verified findings. Proving the pause/resume mechanism is the point; granting
write authority is a separate decision with its own policy gate.

## Ground rules, enforced rather than documented

- **No provider SDK, no database driver.** `tests/test_worker_boundaries.py`
  AST-scans every module and fails if `anthropic`, `openai`, `sqlalchemy`,
  `asyncpg` or similar is imported, and checks the requirements files too.
- **No provider credential in the environment.** The worker refuses to start
  while `ANTHROPIC_API_KEY`, `DATABASE_URL` or similar is set, naming the
  variable. A worker holding a key would make the gateway optional in practice.
- **One checkpointer per process**, injected, held for the process lifetime.
  Constructing one per invocation is the defect that makes durability fake.

## Honest limitations

- **Checkpoints are worker-local.** `AsyncSqliteSaver` writes to a file, so a
  paused run must resume on the same worker. Postgres removes the constraint —
  `AsyncPostgresSaver` satisfies the same interface, so it replaces
  `checkpoint.py` and nothing else.
- **One worker.** Concurrency beyond one needs the shared checkpointer above.
- **No queue.** Runs are started from the CLI, not claimed from a work queue.
  The Postgres queue with leases, retries, an outbox and a DLQ is Phase 5.
- **Effectively once, not exactly once.** The idempotency guard means a
  re-entered node does not repeat its effect. It is not a distributed
  transaction, and it is not described as one.

## What lands here next

1. **Queue consumers** draining a Postgres job queue (`SELECT … FOR UPDATE SKIP
   LOCKED`; no Redis until load tests demand it), with retries, an outbox
   deliverer and a dead-letter queue.
2. **Async generation jobs** — image and video work that must never block an
   HTTP request; assets to R2, referenced from Postgres.
3. **More agents** — Reply Router next, then the write-capable ones, each
   proposal-only until its policy thresholds are approved.

Tool output, webhook bodies and retrieved documents are data, never
instructions.

## Tests

```bash
cd workers && ./.venv/Scripts/python.exe -m pytest -q
```

`test_a_run_survives_the_process_that_started_it` spawns a real second
interpreter to resume the run, and its gateway raises if anything tries to call
a model. Swapping `AsyncSqliteSaver` for `MemorySaver` leaves every other test
passing and fails that one — which is the point.
