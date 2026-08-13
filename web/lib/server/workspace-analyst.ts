import 'server-only'
import { cookies } from 'next/headers'
import type { Citation } from '../types'
import { allowLocalAnalyst } from './env'
import { GENERATION_TIMEOUT_MS, helmApiPost } from './helm-api-client'
import { requireAccessToken } from './session-token'

/** What the Workspace UI needs from an Analyst answer. */
export interface AnalystAnswer {
  text: string
  /** Only citations that survived helm-api's verification. May be empty. */
  citations: Citation[]
  /** False when no citation verified: the answer must be presented as ungrounded. */
  grounded: boolean
}

/**
 * The wire shape of api/app/api/v1/workspace.py's AnswerResponse. Fields the
 * UI does not render (doc, heading, quote, start_line, corpus_digest, ...)
 * are deliberately not modelled: parsing them here would freeze them into
 * this contract without a consumer.
 */
interface QuestionResponse {
  data: string
  citations: { label: string; source: string }[]
  meta: { grounded: boolean }
}

/**
 * Ask the HELM Analyst a question, through the real boundary:
 * BFF -> FastAPI -> gateway (policy -> reserve -> provider -> reconcile) ->
 * citation verification. Nothing here fabricates an answer; every failure
 * propagates as a typed HelmApiError (or UnauthenticatedError) for the
 * server action to translate.
 *
 * The `helm_active_tenant` cookie rides along as the same non-authoritative
 * hint the shell sends: FastAPI resolves membership against the token, not
 * the hint.
 */
export async function askAnalystFromApi(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<AnalystAnswer> {
  // In local-analyst mode the API resolves its fixed read-only local principal
  // and never reads the bearer value; the placeholder only satisfies the
  // request shape. It is NOT a credential and verifies against nothing.
  const accessToken = allowLocalAnalyst() ? 'local-principal' : await requireAccessToken()
  const tenantHint = (await cookies()).get('helm_active_tenant')?.value

  const response = await helmApiPost<QuestionResponse>({
    path: '/api/v1/workspace/questions',
    accessToken,
    tenantHint,
    body: { question, history },
    // One key per ask: a network-level retry of THIS ask deduplicates, while
    // asking the same question twice on purpose still runs twice.
    idempotencyKey: crypto.randomUUID(),
    timeoutMs: GENERATION_TIMEOUT_MS,
  })

  return {
    text: response.data,
    citations: response.citations.map((c) => ({ label: c.label, source: c.source })),
    grounded: response.meta.grounded,
  }
}
