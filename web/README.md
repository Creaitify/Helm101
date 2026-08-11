# web — HELM UI + BFF

One Next.js 16 (App Router) deployment that is both the frontend and the
backend-for-frontend. The browser talks only to this service; this service
talks only to `../api` (FastAPI). The Auth0 access token lives in an encrypted
httpOnly session cookie, is extracted server-side with `getToken()`, and never
appears in a browser-readable response.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

With an empty `.env.local` the app runs in **demo mode**: every surface renders
from the fixtures in `lib/data/mock/fixtures.ts` (derived from
`../helm-mockup-v4.html`, the pixel source of truth) and the tenant shell uses
the fixture tenant. Demo mode is on exactly when `HELM_API_BASE_URL` is unset,
or force it either way with `HELM_DEMO_MODE=true|false`.

For live mode (real sign-in + tenant resolution), copy `.env.example` to
`.env.local` and fill in the Auth0 block and `HELM_API_BASE_URL` — see
`../docs/runbooks/auth0-setup.md` and `../docs/PENDING.md`.

## Verify

```bash
npm test           # vitest
npx tsc --noEmit
npm run lint
npm run build      # catches client components importing server-only modules
```

## Map

| Path | Role |
|---|---|
| `app/(app)/…` | The 12 surfaces (Operate + Master Console). Data comes from `lib/data` — fixtures today, swapped per-endpoint to API calls in phase 2 (`TODO(phase-2)` markers). |
| `app/login`, `app/no-access`, `app/api/auth/**` | Auth surface (NextAuth + Auth0: code flow, embedded password grant, signup). |
| `auth.ts`, `proxy.ts` | Provider registration + token custody; route protection. |
| `lib/server/` | Server-only BFF core: `helm-api-client.ts` (the only module that knows the API's URL), `tenant-directory.ts`, `shell-data.ts`, `auth0-*.ts`, `env.ts`. |
| `lib/data/` | The data seam. `lib/data/mock/fixtures.ts` feeds every surface until real endpoints exist. |
| `components/` | `shell/` (AppShell, Sidebar, TopBar), `ui/`, `viz/` — presentation only. |

The design system lives in `app/globals.css`; roles/gating in `lib/rbac.ts` are
UI labels only — the canonical vocabulary is the API's (`lib/server/role-mapping.ts`).
