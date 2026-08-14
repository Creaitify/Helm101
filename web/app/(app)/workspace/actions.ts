'use server'

import type { Citation } from '@/lib/types'
import { allowLocalAnalyst, isDemoMode } from '@/lib/server/env'
import { cannedReply } from '@/lib/workspace'
import { askAnalystFromApi } from '@/lib/server/workspace-analyst'
import { HelmApiError } from '@/lib/server/helm-api-errors'
import { UnauthenticatedError } from '@/lib/server/session-token'

// Mirrors QuestionRequest's bounds in api/app/api/v1/workspace.py, so an
// oversized payload fails here with a typed result instead of surfacing as
// an opaque 422 from FastAPI.
const MAX_QUESTION_LENGTH = 4_000
const MAX_HISTORY_TURNS = 20

/** One prior conversation turn, replayed to the API for continuity. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

function isValidTurn(turn: unknown): turn is ChatTurn {
  if (typeof turn !== 'object' || turn === null) return false
  const { role, content } = turn as { role?: unknown; content?: unknown }
  return (
    (role === 'user' || role === 'assistant') &&
    typeof content === 'string' &&
    content.length > 0 &&
    content.length <= MAX_QUESTION_LENGTH
  )
}

/**
 * The closed set of failures the client is allowed to see. Everything the
 * backend can throw maps into one of these; raw error messages never cross
 * the boundary (a server action response is a network payload).
 */
export type AskFailureCode =
  | 'invalid_question'
  | 'unauthenticated'
  | 'budget_exceeded'
  | 'kill_switch_engaged'
  | 'provider_refused'
  | 'upstream_unreachable'
  | 'upstream_error'

export type AskResult =
  | { ok: true; text: string; citations: Citation[]; grounded: boolean; live: boolean }
  | { ok: false; code: AskFailureCode }

const PASSTHROUGH_CODES = new Set<AskFailureCode>([
  'budget_exceeded',
  'kill_switch_engaged',
  'provider_refused',
  'upstream_unreachable',
])

/**
 * Server-action seam for WorkspaceView (a client component).
 *
 * The question is attacker-controlled -- this is a network endpoint, so the
 * UI trimming its input proves nothing about what a direct call might send.
 *
 * Demo: the canned reply, exactly as before the cutover, so a checkout with
 * no credentials still demonstrates the surface. The shell banner labels it
 * synthetic.
 *
 * Live: the real Analyst through the real boundary -- FastAPI verifies the
 * JWT, the gateway meters the call, and only verified citations come back.
 */
export async function askWorkspaceQuestion(
  question: string,
  history: ChatTurn[] = [],
): Promise<AskResult> {
  if (typeof question !== 'string') return { ok: false, code: 'invalid_question' }
  const trimmed = question.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_QUESTION_LENGTH) {
    return { ok: false, code: 'invalid_question' }
  }
  // History is attacker-controlled like everything else on this boundary. An
  // invalid shape is rejected outright rather than silently filtered — the
  // UI never produces one, so one arriving means the caller is not the UI.
  if (!Array.isArray(history) || history.length > MAX_HISTORY_TURNS || !history.every(isValidTurn)) {
    return { ok: false, code: 'invalid_question' }
  }

  // ALLOW_LOCAL_ANALYST carves the one live-capable surface out of demo mode:
  // the shell stays synthetic, but questions reach the real gateway.
  if (isDemoMode() && !allowLocalAnalyst()) {
    const reply = cannedReply(trimmed)
    return { ok: true, text: reply.text, citations: reply.citations, grounded: true, live: false }
  }

  try {
    const answer = await askAnalystFromApi(trimmed, history)
    return { ok: true, ...answer, live: true }
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, code: 'unauthenticated' }
    if (error instanceof HelmApiError) {
      // Gateway problem codes keep their identity (the UI must be able to say
      // "out of budget", not "something went wrong"); everything else
      // collapses so an unexpected upstream code is never echoed onward.
      const code = error.code as AskFailureCode
      return { ok: false, code: PASSTHROUGH_CODES.has(code) ? code : 'upstream_error' }
    }
    return { ok: false, code: 'upstream_error' }
  }
}

import {
  fetchWorkspaceThreads,
  fetchThreadDetail,
  createWorkspaceThread,
  updateWorkspaceThread,
  deleteWorkspaceThread,
  appendMessageToThread,
} from '@/lib/server/workspace-threads'
import type { WorkspaceThread, WorkspaceMessage } from '@/lib/types'

export async function getWorkspaceThreadsAction(search?: string, tag?: string): Promise<WorkspaceThread[]> {
  return await fetchWorkspaceThreads('letstute', search, tag)
}

export async function getThreadDetailAction(threadId: string): Promise<WorkspaceThread | null> {
  return await fetchThreadDetail(threadId, 'letstute')
}

export async function createThreadAction(title: string, tag?: string): Promise<WorkspaceThread> {
  return await createWorkspaceThread(title, tag, 'letstute')
}

export async function updateThreadAction(
  threadId: string,
  updates: { title?: string; is_pinned?: boolean; tag?: string },
): Promise<WorkspaceThread | null> {
  return await updateWorkspaceThread(threadId, updates, 'letstute')
}

export async function deleteThreadAction(threadId: string): Promise<boolean> {
  return await deleteWorkspaceThread(threadId, 'letstute')
}

export async function saveMessageAction(
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
  citations?: Citation[],
  grounded?: boolean,
): Promise<WorkspaceMessage> {
  return await appendMessageToThread(threadId, role, content, 'Claude', citations, grounded, 'letstute')
}

