# HELM — Fast-follow backlog

Tracked deferrals surfaced by whole-branch reviews. Not blocking; address in a later polish pass.

## Operate surfaces (sub-project 2) — spec §4 detail gaps
_From the 2026-07-18 final whole-branch review of `feat/operate-surfaces` (merged as-is, all tests green)._

1. **Approvals — Edit affordance.** `ApprovalsView` "Edit" currently calls the same path as Approve. Spec §4.4 wants Edit to open the payload for a mock tweak before approving (e.g. open the detail in a SlideOver/inline editor). — `helm-app/app/(app)/approvals/ApprovalsView.tsx`
2. **Creative Studio — acknowledge-to-ship.** Flagged (SEBI) variants are permanently unshippable. Spec §4.2 wants an "acknowledge risk" control that unlocks Ship after explicit acknowledgement. — `helm-app/app/(app)/studio/StudioView.tsx`
3. **Workspace — typewriter reply.** The assistant reply appears all at once via one `setTimeout`. Spec §3/§4.3 want a token-by-token interval reveal (clear the interval on unmount). — `helm-app/app/(app)/workspace/WorkspaceView.tsx`
4. **Workspace — file-attach chip.** Spec §4.3's mock file-attach (selecting a file shows an attached chip) is not implemented. — `helm-app/app/(app)/workspace/WorkspaceView.tsx`
5. **Campaigns — sortable columns.** Spec §4.1/§6 call for sortable columns; the table headers are static (filter + drawer work and are tested). Add sort state + clickable headers + a `sort reorders` test. — `helm-app/app/(app)/campaigns/CampaignsView.tsx`
6. **Campaigns — wire the drawer chart to `detail.series`.** `getCampaignDetail` returns a 14-point `series` that the drawer's `<TrendChart />` ignores (renders the static decorative chart). Drive a real mini-chart from `series`. — `helm-app/app/(app)/campaigns/CampaignsView.tsx`

### Made cheaper by Phase A (still open)
_From the Phase A ("real spine": auth + tenant-scoped data) work, tasks 1-14._
- Item 6 (drawer chart): `campaign_metrics` now supplies a real 14-point series through
  `getCampaignDetail().series`. The drawer still renders the static decorative chart -- wiring it
  up is now a pure frontend change against real data, no backend work required.
- Item 1 (Approvals edit): `approvals.payload` is now a jsonb column holding the editable
  payload, and the approve path already writes an audited status transition through
  `app/(app)/approvals/actions.ts`. An inline editor has real data to read and a real write path
  to extend -- no new column or endpoint needed.

### New deferrals from Phase A
- **OAuth is not configured in this workspace.** No `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (or
  Entra equivalent) in `.env.local`. Sign-in, and everything downstream of a real session
  (campaigns/approvals rendering live rows, approving in the UI), cannot be exercised end to end
  until real OAuth credentials are provisioned. See `helm-app/docs/foundations.md`'s "Phase A:
  what's done and what's pending" section.
- **`NEON_DATABASE_URL` needs a one-time repoint from `neondb_owner` to `helm_app`.** The app
  currently runs against the bypassing owner role locally; a boot-time guard
  (`assertRuntimeRoleCannotBypassRls`) correctly refuses to serve tenant-scoped queries through it
  rather than silently leaking data, but that also means no real data renders locally until
  `npm run db:provision-app-role` is run and `NEON_DATABASE_URL` is repointed.
- **Stray `probe-t` tenant** in the shared dev database cannot be deleted (`audit_log` is
  append-only and references it). Harmless but will show up in tenant-switcher lists; only fixed
  by recreating the database.

## Prototype (sub-project 1) — deferred
- Mobile: sidebar is a top-stacked panel under ~820px, not a proper icon-rail/drawer (spec §5 envisioned a drawer).
- Move remaining page-level presentational datasets (heatmap seed, gauge targets, leaderboard/approvals rows on Analytics) into `lib/data`.
- `DataTable` uses `any` for columns/rows — tighten types.

## SECURITY — Phase A `helm_lookup_membership` is exploitable via `pg_temp` (open)

_Found 2026-08-05 during the Stage 1 RLS-gap fix review. This is live in `helm-app`, not
a branch-only issue._

`helm-app/db/migrations/0008_membership_lookup_all.sql:35` declares
`set search_path = public` on a `security definer` function. **`pg_temp` is implicitly
searched first when it is not listed explicitly**, and it is writable by any role holding
`TEMP` on the database (which `PUBLIC` has by default).

Any role that can `EXECUTE` the function can therefore shadow `users` with a temp table it
controls, and the definer-rights function will read the attacker's table instead of the
real one. The same class of defect was reproduced as a working privilege escalation
against the FastAPI equivalent: an attacker maps an arbitrary identity to a victim's real
`user_id`, calls the function, and receives the victim's tenants, roles and scopes — for
an identity that exists nowhere in the real `users` table.

Because this function is the identity-resolution step, subverting it subverts
authentication itself.

**Fix:** `set search_path = public, pg_temp` — listing `pg_temp` explicitly and last
removes its implicit priority. Verified effective against the exploit on the FastAPI side.

Add a regression test that creates a temp `users` table shadowing the real one, calls
`helm_lookup_membership`, and asserts zero rows. The existing cross-identity tests cannot
catch this because they never manipulate `search_path`.

Blast radius today is limited to whoever holds `EXECUTE` (the app role), so it requires
SQL injection or a compromised app connection to reach — but the entire justification for
`SECURITY DEFINER` is that it is safe to grant, and this defeats that.
