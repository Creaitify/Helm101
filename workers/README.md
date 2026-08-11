# workers/ — the async spine (not built yet)

This directory is the designated home for HELM's background processing, per the
technical blueprint (Phases 5–6). It stays empty until the model gateway and
Studio generation exist inside `api/` (Phases 3–4).

What lands here, in order:

1. **Queue consumers** — Python workers draining the Postgres job queue
   (`SELECT ... FOR UPDATE SKIP LOCKED`; no Redis until load tests demand it),
   with retries, an outbox deliverer, and a dead-letter queue.
2. **Async generation jobs** — image/video generation that must never block an
   HTTP request; assets land in R2, referenced from Postgres.
3. **LangGraph agent runtime** — durable, checkpointed agent graphs (Analyst
   first, read-only; then Reply Router) that pause on `interrupt()` for human
   approval and resume from the exact checkpoint.

Ground rules already decided (see `docs/PENDING.md` and the blueprint):

- Workers read and write through the same tenant-scoped RLS rules as humans —
  no bypass roles.
- Every model call goes through the gateway in `api/` (policy → reserve budget
  → call → verdict → reconcile → audit). Workers never hold provider keys.
- Tool output, webhook bodies, and retrieved documents are data, never
  instructions.
