// RLS isolation and bypass red-team verification.
//
// THE SINGLE MOST IMPORTANT THING ABOUT THIS SCRIPT: it must never run its
// isolation checks through a connection that can bypass RLS.
//
// `NEON_DATABASE_URL_UNPOOLED` authenticates as `neondb_owner`, which has
// `rolbypassrls = true` (verified live: `select rolbypassrls from pg_roles
// where rolname = 'neondb_owner'` returns `true`). Postgres row-level
// security is unconditionally ignored by any role with rolbypassrls, no
// matter how correct the policies are. A verification script that runs its
// checks as `neondb_owner` would see every row regardless of policy and
// print PASS on a completely leaking database -- this is exactly how the
// original tenant-isolation defect in this project went unnoticed: the app
// was connecting as `neondb_owner`, the policies were all syntactically
// correct, and they were entirely inert.
//
// This script therefore uses the owner connection for ONLY three things:
//   1. Reading/seeding fixtures needed to make the checks meaningful.
//   2. Provisioning (and later dropping) a throwaway non-bypassing probe
//      role, if no real app-role connection string is available.
//   3. Nothing else. Every isolation check below runs through a SEPARATE
//      connection authenticated as the role under test.
//
// Role under test selection:
//   - If NEON_APP_DATABASE_URL is set, that connection string is used
//     directly (expected to authenticate as helm_app).
//   - Otherwise, a temporary role `helm_rls_verify_<random>` is created with
//     `login nobypassrls`, granted the exact same privileges migration 0005
//     grants `helm_app` (select/insert/update/delete on all tables in schema
//     public, usage on schema public, execute on
//     helm_lookup_membership(text)), used for every check, then dropped
//     (grants revoked first -- a role with live grants cannot be dropped).
//
// Before running a single isolation check, the script queries
// pg_roles.rolbypassrls for the role under test and exits 1 immediately,
// loudly, if it is anything other than false. No check result is trusted
// until that gate passes.
//
// Fixture/cleanup constraint: `audit_log` is append-only (trigger-enforced)
// and `tenants` has `on delete restrict` from every tenant-owned table
// including audit_log -- a tenant that ever receives an audit_log row can
// never be deleted again (this already happened once in this project: a
// stray `probe-t` tenant is permanently stuck in the database because of an
// earlier probe run). This script:
//   - never inserts into audit_log,
//   - never creates a new tenant,
//   - reuses the two tenants that already exist in the database as "tenant
//     A" (the one with real seeded data) and "tenant B" (the tenant used as
//     the attacking context),
//   - inserts a small fixture row into any of conversations / messages /
//     tenant_model_policies / usage_events for which TENANT A SPECIFICALLY
//     currently has zero rows (checked with a tenant_id-filtered count, not
//     a global one -- another tenant having rows must not suppress tenant
//     A's fixture, or the isolation check for that table becomes vacuous),
//     attributed to tenant A, and deletes exactly those rows again at the
//     end,
//   - drops the throwaway probe role at the end, if one was created.
// Cleanup success is verified at the end of the run (see the "cleanup
// verification" section) and printed, not just assumed.

import nextEnv from '@next/env'
import { Pool } from '@neondatabase/serverless'
import { randomBytes } from 'node:crypto'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const ownerConnectionString = process.env.NEON_DATABASE_URL_UNPOOLED
if (!ownerConnectionString) {
  console.error('NEON_DATABASE_URL_UNPOOLED is required (owner connection, used only for fixture setup and probe-role provisioning).')
  process.exit(1)
}

let failures = 0
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}
// Throws rather than calling process.exit() directly, so the outer
// try/finally still runs fixture and probe-role cleanup before the process
// exits (see the top-level catch below). A bare process.exit() here would
// skip that finally block entirely and leave fixture rows / a throwaway role
// orphaned in the database on any fatal path that fires after fixtures were
// already inserted.
class FatalVerificationError extends Error {}
const fatal = (message) => {
  throw new FatalVerificationError(message)
}

const TENANT_TABLES = [
  'campaigns', 'ad_groups', 'campaign_metrics', 'creatives', 'approvals',
  'conversations', 'messages', 'prompt_templates', 'users', 'integrations',
  'audit_log', 'tenant_model_policies', 'usage_events',
]

const ownerPool = new Pool({ connectionString: ownerConnectionString })
const owner = await ownerPool.connect()

let probeRoleCreated = false
let probeRoleName = null
let appPool = null
let insertedFixtureConversationId = null
let insertedFixtureMessageId = null
let insertedFixtureUsageEventId = null
let insertedFixtureTenantModelPolicyTenantId = null
let initialTenantCount = null

let fatalError = null

try {
  // --- Fixtures: reuse existing tenants, never create one ------------------
  const tenants = await owner.query('select id, slug from tenants order by created_at')
  initialTenantCount = tenants.rows.length
  if (tenants.rows.length < 2) {
    fatal(
      `Need at least 2 existing tenants to test cross-tenant isolation, found ${tenants.rows.length}. ` +
        'This script deliberately does not create a new tenant (a throwaway tenant can never be deleted ' +
        'once it has an audit_log row -- see header comment). Seed a second tenant first.',
    )
  }

  // Prefer the tenant with actual data as "A" (the one being attacked), and
  // any other tenant as "B" (the attacking context). Rank by row count across
  // a representative table so the leak check is meaningful, not vacuous.
  const campaignCounts = await owner.query(
    'select tenant_id, count(*)::int as n from campaigns group by tenant_id',
  )
  const countByTenant = new Map(campaignCounts.rows.map((r) => [r.tenant_id, r.n]))
  const ranked = [...tenants.rows].sort(
    (x, y) => (countByTenant.get(y.id) ?? 0) - (countByTenant.get(x.id) ?? 0),
  )
  const [a, b] = ranked
  console.log(`Tenant A (attacked, expected to have real data) = ${a.slug} (${a.id})`)
  console.log(`Tenant B (attacking context)                    = ${b.slug} (${b.id})`)

  // A seeded user on tenant A, used both as the fixture owner for
  // conversations and as the email probed via helm_lookup_membership below.
  const seededUser = await owner.query(
    'select id, email from users where tenant_id = $1 order by created_at limit 1',
    [a.id],
  )
  if (!seededUser.rows[0]) {
    fatal(`Tenant A (${a.slug}) has no users row to use as a fixture owner / membership-lookup probe.`)
  }
  const { id: seededUserId, email: seededEmail } = seededUser.rows[0]
  console.log(`Seeded email used for helm_lookup_membership probe: ${seededEmail}`)

  // Insert exactly one fixture row into any tenant-owned table that
  // currently has zero rows FOR TENANT A SPECIFICALLY, so "tenant B sees
  // zero rows of tenant A's data" is a meaningful assertion rather than
  // trivially true because tenant A has no data in that table. A global
  // (un-filtered) count would be fooled by some OTHER tenant having rows
  // while tenant A has none -- the guard must be per-tenant, not per-table.
  // audit_log is deliberately never touched (append-only + permanently
  // undeletable tenant, see header).
  await owner.query('begin')
  await owner.query("select set_config('app.tenant_id', $1, true)", [a.id])

  const conversationCount = await owner.query('select count(*)::int as n from conversations where tenant_id = $1', [a.id])
  if (conversationCount.rows[0].n === 0) {
    const convo = await owner.query(
      `insert into conversations (tenant_id, user_id, title) values ($1, $2, 'RLS verify fixture')
       returning id`,
      [a.id, seededUserId],
    )
    insertedFixtureConversationId = convo.rows[0].id
    console.log(`Inserted fixture conversations row ${insertedFixtureConversationId} for cleanup-verified isolation check`)
  }

  // messages is a child of conversations. Its own isolation policy is
  // independent of the conversations policy (RLS is per-table), so it needs
  // its own fixture row even when a conversations fixture already exists --
  // otherwise the messages isolation check runs against zero rows and is
  // vacuously true regardless of whether messages_tenant_isolation exists.
  // Parented to insertedFixtureConversationId when we just created one, or
  // to any existing tenant-A conversation otherwise (never inserts a
  // conversation solely to hang a message off of it).
  const messageCount = await owner.query('select count(*)::int as n from messages where tenant_id = $1', [a.id])
  if (messageCount.rows[0].n === 0) {
    let parentConversationId = insertedFixtureConversationId
    if (!parentConversationId) {
      const existingConvo = await owner.query(
        'select id from conversations where tenant_id = $1 order by created_at limit 1',
        [a.id],
      )
      parentConversationId = existingConvo.rows[0]?.id ?? null
    }
    if (!parentConversationId) {
      fatal(`Tenant A (${a.slug}) has no conversations row to parent a messages fixture under, and none was just created.`)
    }
    const message = await owner.query(
      `insert into messages (tenant_id, conversation_id, role, text) values ($1, $2, 'user', 'RLS verify fixture')
       returning id`,
      [a.id, parentConversationId],
    )
    insertedFixtureMessageId = message.rows[0].id
    console.log(`Inserted fixture messages row ${insertedFixtureMessageId} for cleanup-verified isolation check`)
  }

  const usageEventCount = await owner.query('select count(*)::int as n from usage_events where tenant_id = $1', [a.id])
  if (usageEventCount.rows[0].n === 0) {
    const usage = await owner.query(
      `insert into usage_events (tenant_id, feature, provider, model, tokens_in, tokens_out, cost_usd)
       values ($1, 'rls-verify', 'rls-verify', 'rls-verify', 0, 0, 0)
       returning id`,
      [a.id],
    )
    insertedFixtureUsageEventId = usage.rows[0].id
    console.log(`Inserted fixture usage_events row ${insertedFixtureUsageEventId} for cleanup-verified isolation check`)
  }

  const policyCount = await owner.query('select count(*)::int as n from tenant_model_policies where tenant_id = $1', [a.id])
  if (policyCount.rows[0].n === 0) {
    await owner.query(
      `insert into tenant_model_policies (tenant_id) values ($1)`,
      [a.id],
    )
    insertedFixtureTenantModelPolicyTenantId = a.id
    console.log(`Inserted fixture tenant_model_policies row for tenant ${a.id} for cleanup-verified isolation check`)
  }

  await owner.query('commit')

  // --- Role under test ------------------------------------------------------
  let appConnectionString = process.env.NEON_APP_DATABASE_URL
  if (appConnectionString) {
    console.log('Using NEON_APP_DATABASE_URL as the role under test.')
  } else {
    console.log('NEON_APP_DATABASE_URL not set -- provisioning a temporary throwaway nobypassrls probe role.')
    probeRoleName = `helm_rls_verify_${randomBytes(6).toString('hex')}`
    const password = randomBytes(32).toString('base64url')

    const quotedIdent = probeRoleName // generated from [a-z0-9], safe as a bare identifier
    await owner.query(`create role ${quotedIdent} login nobypassrls password '${password}'`)
    probeRoleCreated = true
    await owner.query(`grant usage on schema public to ${quotedIdent}`)
    await owner.query(`grant select, insert, update, delete on all tables in schema public to ${quotedIdent}`)
    await owner.query(`grant execute on function helm_lookup_membership(text) to ${quotedIdent}`)

    const url = new URL(ownerConnectionString)
    url.username = probeRoleName
    url.password = password
    appConnectionString = url.toString()
    console.log(`Created temporary probe role: ${probeRoleName}`)
  }

  appPool = new Pool({ connectionString: appConnectionString })
  const app = await appPool.connect()

  try {
    // --- Gate: the role under test must not be able to bypass RLS ----------
    const roleCheck = await app.query(
      'select current_user as role, rolbypassrls from pg_roles where rolname = current_user',
    )
    const roleRow = roleCheck.rows[0]
    if (!roleRow) {
      fatal('Could not determine the connecting role under test (pg_roles lookup returned no row).')
    }
    console.log(`\nRole under test: ${roleRow.role}  rolbypassrls=${roleRow.rolbypassrls}`)
    if (roleRow.rolbypassrls !== false) {
      fatal(
        `Role under test "${roleRow.role}" has rolbypassrls = ${roleRow.rolbypassrls}. ` +
          'A bypassing role sees every row regardless of policy correctness and would make every ' +
          'check below meaningless (PASS on a leaking database). Refusing to proceed.',
      )
    }
    check(`role under test (${roleRow.role}) has rolbypassrls = false`, roleRow.rolbypassrls === false)

    // --- Cross-tenant read isolation, every tenant-owned table -------------
    for (const table of TENANT_TABLES) {
      await app.query('begin')
      await app.query("select set_config('app.tenant_id', $1, true)", [b.id])
      const leaked = await app.query(`select count(*)::int as n from ${table} where tenant_id = $1`, [a.id])
      await app.query('commit')
      check(`${table}: tenant B context cannot read tenant A rows`, leaked.rows[0].n === 0)
    }

    // --- Fail-closed on empty context, every tenant-owned table ------------
    for (const table of TENANT_TABLES) {
      await app.query('begin')
      await app.query("select set_config('app.tenant_id', '', true)")
      const empty = await app.query(`select count(*)::int as n from ${table}`)
      await app.query('commit')
      check(`${table}: empty tenant context returns zero rows (fail closed)`, empty.rows[0].n === 0)
    }

    // --- Bare, contextless read of users returns zero rows -----------------
    await app.query('begin')
    await app.query("select set_config('app.tenant_id', '', true)")
    const bareUsers = await app.query('select count(*)::int as n from users')
    await app.query('commit')
    check('bare "select count(*) from users" with no context returns 0', bareUsers.rows[0].n === 0)

    // --- SECURITY DEFINER membership lookup works without opening `users` --
    await app.query('begin')
    await app.query("select set_config('app.tenant_id', '', true)")
    const membership = await app.query('select * from helm_lookup_membership($1)', [seededEmail])
    const usersStillZero = await app.query('select count(*)::int as n from users')
    await app.query('commit')
    check(
      `helm_lookup_membership('${seededEmail}') returns >= 1 row (SECURITY DEFINER path works)`,
      membership.rows.length >= 1,
    )
    check(
      'select count(*) from users still returns 0 in the same contextless session (membership lookup did not open the table)',
      usersStillZero.rows[0].n === 0,
    )
  } finally {
    app.release()
  }
} catch (error) {
  if (error instanceof FatalVerificationError) {
    fatalError = error
  } else {
    throw error
  }
} finally {
  // --- Fixture cleanup, verified ---------------------------------------------
  console.log('\nCleaning up fixtures...')
  await owner.query('begin').catch(() => {})
  try {
    if (insertedFixtureMessageId) {
      // Deleted explicitly (not left to conversations' on-delete-cascade) so
      // its own cleanup is independently verified below, and so it is
      // removed correctly even in the case where insertedFixtureConversationId
      // is null (fixture message parented to a pre-existing conversation).
      await owner.query('delete from messages where id = $1', [insertedFixtureMessageId])
    }
    if (insertedFixtureConversationId) {
      await owner.query('delete from conversations where id = $1', [insertedFixtureConversationId])
    }
    if (insertedFixtureUsageEventId) {
      await owner.query('delete from usage_events where id = $1', [insertedFixtureUsageEventId])
    }
    if (insertedFixtureTenantModelPolicyTenantId) {
      await owner.query('delete from tenant_model_policies where tenant_id = $1', [insertedFixtureTenantModelPolicyTenantId])
    }
    await owner.query('commit')
  } catch (cleanupError) {
    await owner.query('rollback').catch(() => {})
    console.error('FIXTURE CLEANUP FAILED:', cleanupError)
    failures += 1
  }

  // Verify fixture cleanup actually took (query back, don't just assume the
  // deletes succeeded because no error was thrown).
  if (insertedFixtureMessageId) {
    const stillThere = await owner.query('select 1 from messages where id = $1', [insertedFixtureMessageId])
    check('fixture messages row was actually deleted', stillThere.rowCount === 0)
  }
  if (insertedFixtureConversationId) {
    const stillThere = await owner.query('select 1 from conversations where id = $1', [insertedFixtureConversationId])
    check('fixture conversations row was actually deleted', stillThere.rowCount === 0)
  }
  if (insertedFixtureUsageEventId) {
    const stillThere = await owner.query('select 1 from usage_events where id = $1', [insertedFixtureUsageEventId])
    check('fixture usage_events row was actually deleted', stillThere.rowCount === 0)
  }
  if (insertedFixtureTenantModelPolicyTenantId) {
    const stillThere = await owner.query('select 1 from tenant_model_policies where tenant_id = $1', [insertedFixtureTenantModelPolicyTenantId])
    check('fixture tenant_model_policies row was actually deleted', stillThere.rowCount === 0)
  }

  if (appPool) await appPool.end().catch(() => {})

  if (probeRoleCreated && probeRoleName) {
    try {
      // Grants must be revoked before the role can be dropped.
      await owner.query(`revoke all privileges on all tables in schema public from ${probeRoleName}`)
      await owner.query(`revoke usage on schema public from ${probeRoleName}`)
      await owner.query(`revoke execute on function helm_lookup_membership(text) from ${probeRoleName}`)
      await owner.query(
        `alter default privileges for role neondb_owner in schema public revoke select, insert, update, delete on tables from ${probeRoleName}`,
      ).catch(() => {}) // best-effort: this role never received a default-privileges grant, but revoke is safe/idempotent if it did
      await owner.query(`drop role ${probeRoleName}`)
      const stillExists = await owner.query('select 1 from pg_roles where rolname = $1', [probeRoleName])
      check(`temporary probe role ${probeRoleName} was actually dropped`, stillExists.rowCount === 0)
    } catch (dropError) {
      console.error(`FAILED TO DROP TEMPORARY PROBE ROLE ${probeRoleName}:`, dropError)
      console.error(`Manual cleanup required: DROP ROLE ${probeRoleName};`)
      failures += 1
    }
  }

  // Verify no stray tenant was created by this run (defense in depth: this
  // script never inserts into `tenants`, but confirm the row count is
  // unchanged from what we started with).
  const finalTenants = await owner.query('select count(*)::int as n from tenants')
  check('tenant row count unchanged (no stray tenant created by this run)', finalTenants.rows[0].n === initialTenantCount)

  owner.release()
  await ownerPool.end()
}

if (fatalError) {
  console.error(`\nFATAL: ${fatalError.message}`)
  console.error('Refusing to trust any isolation check result from this run. Do not ship.')
  process.exit(1)
}

if (failures > 0) {
  console.error(`\n${failures} RLS check(s) FAILED — do not ship.`)
  process.exit(1)
}
console.log('\nAll RLS checks passed.')

