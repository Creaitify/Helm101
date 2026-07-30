# HELM Roles and Scopes (Stage 0)

Roles are membership-local presets, not global user attributes. Effective authorization is scope-based and evaluated by FastAPI. Roles may be assigned only through `tenant_memberships`; a user can hold different roles in different tenants. The old prototype labels `master`, `agency`, and `viewer` are not canonical production roles.

## Canonical roles

| Role | Intended access |
|---|---|
| `owner` | Tenant ownership, governance, membership and policy administration |
| `agency_admin` | Operational administration for client tenants explicitly assigned to the agency |
| `strategist` | Campaign strategy, approval decisions, and governed operational commands |
| `creative` | Creative briefs/assets and submissions; no spending or tenant administration |
| `analyst` | Read analytics and produce analysis; no campaign mutation by default |
| `client_viewer` | Read-only, client-safe view of explicitly permitted data |

## Scope catalogue and default grants

| Scope family | Owner | Agency admin | Strategist | Creative | Analyst | Client viewer |
|---|---:|---:|---:|---:|---:|---:|
| `tenant.read` | yes | yes | yes | yes | yes | yes |
| `tenant.manage` | yes | no | no | no | no | no |
| `membership.read` | yes | yes | no | no | no | no |
| `membership.manage` | yes | no | no | no | no | no |
| `campaign.read` / `analytics.read` | yes | yes | yes | yes | yes | yes* |
| `campaign.plan` | yes | yes | yes | no | no | no |
| `campaign.execute` | yes | yes | no | no | no | no |
| `budget.propose` | yes | yes | yes | no | no | no |
| `budget.approve` | yes | yes | yes | no | no | no |
| `creative.read` / `creative.create` | yes | yes | yes | yes | no | no* |
| `creative.submit` / `creative.approve` | yes | yes | yes | yes / no | no | no |
| `approval.read` | yes | yes | yes | yes† | yes† | no* |
| `approval.decide` | yes | yes | yes | no | no | no |
| `integration.read` | yes | yes | yes | no | no | no |
| `integration.manage` | yes | yes | no | no | no | no |
| `workspace.use` | yes | yes | yes | yes | yes | no by default |
| `agent.run` / `agent.manage` | yes | yes | propose only / no | no | no | no |
| `gateway.policy.manage` / `usage.read` | yes | no / yes | no / yes | no | no / yes | no |
| `audit.read` | yes | yes | no | no | no | no |

\* Client-visible fields are a separate presentation/data-policy filter, not simply raw read access.  
† Read only approvals relevant to submitted assets or assigned work; no unrestricted tenant approval history.

## Guardrails on high-impact actions

Scopes admit an action; they do not guarantee automatic execution. Budget changes, sending communications, publishing ads, destructive integration changes, model-policy changes, exports containing personal data, and identity administration require policy checks. Suggested defaults: campaign executions and integration credential changes are always human-approved; strategists can approve bounded budget proposals only within tenant caps; `owner` retains final governance authority. Enforce separation of duties where a policy demands it (for example, proposer cannot approve their own high-risk action).

## Scope assignment rules

Role defaults are centrally versioned. Per-membership grants may add only a reviewed allow-list; restrictions always remove access. Every change has an actor, reason, effective time, and audit event. Never encode tenant access in email domains, frontend navigation, or an agency “super-admin” bypass.
