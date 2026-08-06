# Tests that pass for the wrong reason

A vacuous test is one that passes whether or not the behaviour it names exists.
It is worse than no test, because it occupies the space where a real test would
go and reports green while doing it.

Seven have been found in this repository so far. Every one was caught by a
reviewer after the code was written, never by the person writing it. One of them
— `expect(sql).toMatch(/set search_path = public/i)` — sat on top of a live,
exploitable privilege-escalation hole and certified it as fixed.

This is the checklist that would have caught them.

## The one question

> **If I break the implementation, does this test fail?**

Not "would it probably fail". Actually break it, run the test, watch it go red,
then revert. This is the only reliable check, and it takes under a minute.

Anything below is a shortcut for spotting likely candidates. The mutation is the
proof.

## Known patterns, all found here

### 1. The unanchored substring match

```ts
expect(sql).toMatch(/set search_path = public/i)   // passes on `public, pg_temp` too
```

`toMatch` searches anywhere in the string. The hardened form contains the
vulnerable form as a prefix, so the assertion cannot distinguish them. It was
named "pins search_path (mandatory for a security definer function)".

**Fix:** assert the exact declaration, and assert position separately when order
carries meaning.

**Smell:** a regex on a security property that has no `^`, `$`, or exact match.

### 2. Serializing something that does not serialize

```ts
expect(JSON.stringify(error)).not.toContain('secret')
```

`Error.prototype.message` is non-enumerable, so `JSON.stringify(new Error(x))` is
`'{}'` — always. The assertion passes with or without a leak.

**Fix:** serialize the fields you actually care about
(`JSON.stringify({ code, message })`), or assert on the property directly.

**Smell:** `JSON.stringify` applied to anything that is not a plain object.

### 3. The same literal as fixture and assertion

```ts
const session = { accessToken: 'token-value' }
expect(client).toHaveBeenCalledWith({ accessToken: 'token-value' })
```

An implementation that hardcodes `'token-value'` and ignores the session passes.
So does one that reads the wrong field, if both fields hold the same value.

**Fix:** distinct, non-substitutable values across at least two invocations —
`token-alpha` and `token-beta` with `toHaveBeenNthCalledWith(1, …)` / `(2, …)`.

**Smell:** one literal appearing in both the setup and the expectation.

### 4. The guard that cannot fire

A `require_scope` test where every role in the fixture set holds the scope. The
403 branch is unreachable, so the guard could be deleted entirely and the suite
stays green.

**Fix:** include a subject that must be refused.

**Smell:** a permission test with no negative case.

### 5. Asserting the database, not your code

```ts
await raw('insert into audit_log …')
await session.rollback()
expect(await count()).toBe(0)
```

This proves PostgreSQL implements ROLLBACK. It says nothing about whether *your*
audit path is atomic.

**Fix:** drive the real code path and inject the failure inside it.

**Smell:** the test never calls the function whose name is in the test's title.

### 6. The setup that dies before the assertion

A seed helper that sets `app.tenant_id` to `''` makes `helm_tenant_id()` return
NULL, so every insert fails `WITH CHECK` and the test errors out before reaching
its assertion — or is skipped and reported as passing.

**Fix:** assert your preconditions hold before exercising the code under test.

**Smell:** a skipped test counted as a passing one.

### 7. Superuser hiding the failure

Code that works as `postgres` and fails as `helm_app`. Every RLS test that
connects with an implicit `BYPASSRLS` role proves nothing about isolation. Found
twice here, both times masking a total failure of the only path a human uses to
enter the system.

**Fix:**

```python
assert (rolbypassrls, rolsuper) == (False, False)
```

before the code under test runs, not after.

**Smell:** an isolation test that never checks what role it is connected as.

## Reviewing

- Run the mutation yourself. Do not accept "mutation-verified" on trust —
  re-derive it. Implementer reports have been wrong about this.
- Read the test's title, then read its body, and ask whether the body could fail
  for the reason the title claims.
- Check the assertion that comes *after* a stronger one. An exact-match `toBe`
  short-circuits everything below it, so a positional or secondary check placed
  after it may never execute. This was found inside a fix for pattern 1 — the
  vacuity reappearing one level down.
- A test asserting a security property deserves the mutation every time, without
  exception.

## Writing

State in your report, for each assertion that matters, what you broke and what
went red. If you cannot describe a mutation that turns a test red, you have not
written a test.
