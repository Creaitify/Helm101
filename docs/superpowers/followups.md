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

## Prototype (sub-project 1) — deferred
- Mobile: sidebar is a top-stacked panel under ~820px, not a proper icon-rail/drawer (spec §5 envisioned a drawer).
- Move remaining page-level presentational datasets (heatmap seed, gauge targets, leaderboard/approvals rows on Analytics) into `lib/data`.
- `DataTable` uses `any` for columns/rows — tighten types.
