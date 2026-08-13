import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { HelmApiError as HelmApiErrorType } from '@/lib/server/helm-api-errors'

const fetchMock = vi.fn()

/**
 * `helm-api-client.ts` resolves its base URL through `env.ts`, which snapshots
 * `process.env` once at module-evaluation time. To make a per-test
 * `process.env.HELM_API_BASE_URL` change actually take effect, both `env.ts`
 * and `helm-api-client.ts` must be re-imported fresh after the env var is set
 * — the same pattern `test/env-auth0.test.ts` uses for `env.ts` directly.
 */
async function loadClient(values: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const [{ helmApiGet, helmApiPost }, { HelmApiError }] = await Promise.all([
    import('@/lib/server/helm-api-client'),
    import('@/lib/server/helm-api-errors'),
  ])
  return { helmApiGet, helmApiPost, HelmApiError }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  })
}

describe('helmApiGet', () => {
  it('sends the access token as a bearer credential', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 'token-value' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer token-value')
  })

  it('sends the tenant hint header only when a hint is given', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't', tenantHint: 'acme' })
    expect(fetchMock.mock.calls[0][1].headers['X-HELM-Active-Tenant']).toBe('acme')

    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })
    expect(fetchMock.mock.calls[1][1].headers['X-HELM-Active-Tenant']).toBeUndefined()
  })

  it('joins the base URL and path without duplicating slashes', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test/' })
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/v1/tenants')
  })

  it('returns the parsed body on success', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ slug: 'acme' }] }))
    const result = await helmApiGet<{ data: { slug: string }[] }>({
      path: '/api/v1/tenants',
      accessToken: 't',
    })
    expect(result.data[0].slug).toBe('acme')
  })

  it('throws a typed error for a problem response', async () => {
    const { helmApiGet, HelmApiError } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(
      jsonResponse(403, { code: 'no_membership' }, 'application/problem+json'),
    )
    await expect(helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })).rejects.toBeInstanceOf(
      HelmApiError,
    )
  })

  it('never lets an upstream body reach the thrown error', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(new Response('postgres://user:pw@host/db', { status: 500 }))
    await expect(
      helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }),
    ).rejects.toSatisfy((error: HelmApiErrorType) => !error.message.includes('postgres://'))
  })

  it('turns a network failure into a retryable typed error, not a raw throw', async () => {
    const { helmApiGet, HelmApiError } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const error = await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(HelmApiError)
    expect((error as HelmApiErrorType).retryable).toBe(true)
  })

  it('refuses to call without a configured base URL', async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: undefined })
    await expect(helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })).rejects.toThrow(
      /helmApiBaseUrl/,
    )
  })

  it('rejects rather than resolving undefined when a 200 body is not JSON', async () => {
    const { helmApiGet, HelmApiError } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    // A proxy or a crashed process can return 200 with an HTML error page. The
    // `readBody` catch above only covers the !ok path; the success path parses
    // unguarded, so this must surface as a rejection rather than handing the
    // caller a value that is not the T it claims to be.
    fetchMock.mockResolvedValue(
      new Response('<html>gateway</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const result = await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )

    expect(result.ok).toBe(false)
    const error = (result as { error: unknown }).error
    expect(error).toBeInstanceOf(HelmApiError)
    // A raw SyntaxError from response.json() embeds the response body verbatim
    // in its message; the typed error must not carry it onward. This caught a
    // real leak on this path — the success branch parsed unguarded while the
    // failure branch was already protected by readBody.
    expect(String(error)).not.toContain('gateway')
    expect((error as HelmApiErrorType).retryable).toBe(true)
  })

  it("does not cache the response — these are per-user authenticated bodies", async () => {
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }))
    await helmApiGet({ path: '/api/v1/tenants', accessToken: 't' })

    // Exact equality, not a truthiness or substring check: 'force-cache' and
    // 'default' are both non-empty strings, and either would let one tenant's
    // authenticated response be served to another.
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store')
  })
})

describe('helmApiPost', () => {
  it('serialises the body as JSON with the matching content type', async () => {
    const { helmApiPost } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(jsonResponse(200, { data: 'ok' }))
    await helmApiPost({
      path: '/api/v1/workspace/questions',
      accessToken: 't',
      body: { question: 'why?' },
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/api/v1/workspace/questions')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ question: 'why?' })
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(init.cache).toBe('no-store')
  })

  it('sends the idempotency key only when given', async () => {
    const { helmApiPost } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(jsonResponse(200, {}))
    await helmApiPost({ path: '/p', accessToken: 't', body: {}, idempotencyKey: 'key-1' })
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe('key-1')

    fetchMock.mockResolvedValue(jsonResponse(200, {}))
    await helmApiPost({ path: '/p', accessToken: 't', body: {} })
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBeUndefined()
  })

  it('translates a gateway problem response without echoing the body', async () => {
    const { helmApiPost, HelmApiError } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    fetchMock.mockResolvedValue(
      jsonResponse(409, { code: 'budget_exceeded' }, 'application/problem+json'),
    )
    const error = await helmApiPost({ path: '/p', accessToken: 't', body: {} }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(HelmApiError)
    expect((error as HelmApiErrorType).code).toBe('budget_exceeded')
    expect((error as HelmApiErrorType).status).toBe(409)
  })
})

/**
 * The timeout gets its own block because it has to be driven artificially.
 *
 * Vitest's fake timers do NOT drive `AbortSignal.timeout` — it is backed by a
 * host-internal timer, not `setTimeout`, so `vi.advanceTimersByTimeAsync` will
 * never fire it (verified directly: a signal from `AbortSignal.timeout(1000)`
 * is still `aborted === false` after advancing 2000ms). Waiting on the real
 * 10s deadline is not an option either.
 *
 * So these tests replace `AbortSignal.timeout` with a stub that records the
 * duration it was asked for and hands back a signal the test can abort on
 * demand. That is what makes them fail if the timeout is removed: with no
 * `AbortSignal.timeout` call there is no recorded duration and no signal to
 * abort, and the request the mocked fetch never answers stays pending.
 *
 * The fetch mock settles ONLY when the signal it was handed aborts, mirroring
 * real `fetch` semantics.
 */
describe('helmApiGet request timeout', () => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal)

  afterEach(() => {
    AbortSignal.timeout = realTimeout
  })

  /**
   * Replaces AbortSignal.timeout with a controllable stub.
   * Returns the recorded durations and a `fire()` that aborts every signal it
   * handed out, standing in for the deadline elapsing.
   */
  function stubTimeout() {
    const durations: number[] = []
    const controllers: AbortController[] = []
    AbortSignal.timeout = ((ms: number) => {
      durations.push(ms)
      const controller = new AbortController()
      controllers.push(controller)
      return controller.signal
    }) as typeof AbortSignal.timeout
    return {
      durations,
      fire: () => {
        for (const c of controllers) c.abort(new DOMException('TimeoutError', 'TimeoutError'))
      },
    }
  }

  /** Resolves the promise fetch returns only when the signal it was given aborts. */
  function fetchThatOnlySettlesOnAbort() {
    return vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal
        // No signal at all means the request hangs forever — exactly the
        // failure mode removing the timeout would introduce.
        if (!signal) return
        if (signal.aborted) return reject(signal.reason)
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    })
  }

  it('arms an abort deadline for the documented duration on every request', async () => {
    const timeout = stubTimeout()
    vi.stubGlobal('fetch', fetchThatOnlySettlesOnAbort())
    const { helmApiGet } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    const { REQUEST_TIMEOUT_MS } = await import('@/lib/server/helm-api-client')

    const pending = helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }).catch(
      (e: unknown) => e,
    )

    // The deadline must be armed before the response arrives, not after.
    expect(timeout.durations).toEqual([REQUEST_TIMEOUT_MS])
    // Exact value, so lowering the constant to 1 (or raising it to something
    // useless) is a failure rather than a silent behaviour change.
    expect(REQUEST_TIMEOUT_MS).toBe(10_000)

    timeout.fire()
    await pending
  })

  it('aborts a request the backend never answers, instead of hanging the render', async () => {
    const timeout = stubTimeout()
    vi.stubGlobal('fetch', fetchThatOnlySettlesOnAbort())
    const { helmApiGet, HelmApiError } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })

    const pending = helmApiGet({ path: '/api/v1/tenants', accessToken: 't' }).catch(
      (e: unknown) => e,
    )

    // Still outstanding before the deadline elapses.
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    timeout.fire()
    const error = await pending
    expect(error).toBeInstanceOf(HelmApiError)
    // The timeout must surface as the retryable upstream-unreachable error, not
    // as a raw DOMException escaping to the caller.
    expect((error as HelmApiErrorType).retryable).toBe(true)
  })

  it('applies the timeout even when the caller supplies its own signal', async () => {
    const timeout = stubTimeout()
    vi.stubGlobal('fetch', fetchThatOnlySettlesOnAbort())
    const { helmApiGet, HelmApiError } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    const { REQUEST_TIMEOUT_MS } = await import('@/lib/server/helm-api-client')

    // A caller signal that never aborts. Under the previous
    // `signal: request.signal ?? AbortSignal.timeout(...)` this REPLACED the
    // timeout outright, so no deadline was ever armed and the request hung.
    const callerSignal = new AbortController().signal
    const pending = helmApiGet({
      path: '/api/v1/tenants',
      accessToken: 't',
      signal: callerSignal,
    }).catch((e: unknown) => e)

    expect(timeout.durations).toEqual([REQUEST_TIMEOUT_MS])

    timeout.fire()
    const error = await pending
    expect(error).toBeInstanceOf(HelmApiError)
    // The caller's own signal was never the thing that aborted.
    expect(callerSignal.aborted).toBe(false)
  })

  it('a POST that opts into the generation budget arms that deadline, not the render one', async () => {
    const timeout = stubTimeout()
    vi.stubGlobal('fetch', fetchThatOnlySettlesOnAbort())
    const { helmApiPost } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })
    const { GENERATION_TIMEOUT_MS } = await import('@/lib/server/helm-api-client')

    const pending = helmApiPost({
      path: '/api/v1/workspace/questions',
      accessToken: 't',
      body: { question: 'q' },
      timeoutMs: GENERATION_TIMEOUT_MS,
    }).catch((e: unknown) => e)

    // A longer deadline, never no deadline.
    expect(timeout.durations).toEqual([GENERATION_TIMEOUT_MS])
    expect(GENERATION_TIMEOUT_MS).toBe(60_000)

    timeout.fire()
    await pending
  })

  it('still honours a caller signal that aborts before the timeout', async () => {
    stubTimeout() // armed but never fired
    vi.stubGlobal('fetch', fetchThatOnlySettlesOnAbort())
    const { helmApiGet, HelmApiError } = await loadClient({ HELM_API_BASE_URL: 'http://api.test' })

    const controller = new AbortController()
    const pending = helmApiGet({
      path: '/api/v1/tenants',
      accessToken: 't',
      signal: controller.signal,
    }).catch((e: unknown) => e)

    controller.abort()
    const error = await pending
    expect(error).toBeInstanceOf(HelmApiError)
  })
})
