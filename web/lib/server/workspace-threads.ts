import { WorkspaceThread, WorkspaceMessage } from '../types'

const HELM_API_BASE_URL = process.env.HELM_API_BASE_URL || 'http://127.0.0.1:8000'

// In-memory demo fallback store for web-only dev or testing without api server running
const memoryThreads: Map<string, WorkspaceThread> = new Map()

export async function fetchWorkspaceThreads(tenantId = 'letstute', search?: string, tag?: string): Promise<WorkspaceThread[]> {
  try {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (tag) params.set('tag', tag)
    const url = `${HELM_API_BASE_URL}/api/v1/workspace/threads?${params.toString()}`
    
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-HELM-Active-Tenant': tenantId,
      },
      cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      return data.threads.map((t: any) => ({
        id: t.id,
        tenantId: t.tenant_id,
        userId: t.user_id,
        title: t.title,
        tag: t.tag,
        isPinned: t.is_pinned,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        lastMessagePreview: t.last_message_preview,
        messageCount: t.message_count,
      }))
    }
  } catch {
    // fall back to memory
  }

  // Return filtered memory threads
  let threads = Array.from(memoryThreads.values()).filter(t => t.tenantId === tenantId)
  if (search) {
    const q = search.toLowerCase()
    threads = threads.filter(t => t.title.toLowerCase().includes(q) || (t.lastMessagePreview || '').toLowerCase().includes(q))
  }
  if (tag) {
    threads = threads.filter(t => t.tag === tag)
  }
  return threads.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

export async function createWorkspaceThread(
  title: string,
  tag?: string,
  tenantId = 'letstute',
  userId = 'usr_operator_01',
): Promise<WorkspaceThread> {
  try {
    const res = await fetch(`${HELM_API_BASE_URL}/api/v1/workspace/threads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HELM-Active-Tenant': tenantId,
      },
      body: JSON.stringify({ title, tag }),
    })
    if (res.ok) {
      const t = await res.json()
      return {
        id: t.id,
        tenantId: t.tenant_id,
        userId: t.user_id,
        title: t.title,
        tag: t.tag,
        isPinned: t.is_pinned,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        messages: [],
      }
    }
  } catch {
    // fallback
  }

  const id = `thr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const now = new Date().toISOString()
  const thread: WorkspaceThread = {
    id,
    tenantId,
    userId,
    title,
    tag,
    isPinned: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
  memoryThreads.set(id, thread)
  return thread
}

export async function fetchThreadDetail(threadId: string, tenantId = 'letstute'): Promise<WorkspaceThread | null> {
  try {
    const res = await fetch(`${HELM_API_BASE_URL}/api/v1/workspace/threads/${threadId}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-HELM-Active-Tenant': tenantId,
      },
      cache: 'no-store',
    })
    if (res.ok) {
      const t = await res.json()
      return {
        id: t.id,
        tenantId: t.tenant_id,
        userId: t.user_id,
        title: t.title,
        tag: t.tag,
        isPinned: t.is_pinned,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        messages: (t.messages || []).map((m: any) => ({
          id: m.id,
          threadId: m.thread_id,
          role: m.role,
          content: m.content,
          model: m.model,
          citations: m.citations,
          grounded: m.grounded,
          tokensIn: m.tokens_in,
          tokensOut: m.tokens_out,
          costMicros: m.cost_micros,
          createdAt: m.created_at,
        })),
      }
    }
  } catch {
    // fallback
  }

  return memoryThreads.get(threadId) || null
}

export async function updateWorkspaceThread(
  threadId: string,
  updates: { title?: string; is_pinned?: boolean; tag?: string },
  tenantId = 'letstute',
): Promise<WorkspaceThread | null> {
  try {
    const res = await fetch(`${HELM_API_BASE_URL}/api/v1/workspace/threads/${threadId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-HELM-Active-Tenant': tenantId,
      },
      body: JSON.stringify(updates),
    })
    if (res.ok) {
      const t = await res.json()
      return {
        id: t.id,
        tenantId: t.tenant_id,
        userId: t.user_id,
        title: t.title,
        tag: t.tag,
        isPinned: t.is_pinned,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }
    }
  } catch {
    // fallback
  }

  const existing = memoryThreads.get(threadId)
  if (!existing) return null
  if (updates.title !== undefined) existing.title = updates.title
  if (updates.is_pinned !== undefined) existing.isPinned = updates.is_pinned
  if (updates.tag !== undefined) existing.tag = updates.tag
  existing.updatedAt = new Date().toISOString()
  memoryThreads.set(threadId, existing)
  return existing
}

export async function deleteWorkspaceThread(threadId: string, tenantId = 'letstute'): Promise<boolean> {
  try {
    const res = await fetch(`${HELM_API_BASE_URL}/api/v1/workspace/threads/${threadId}`, {
      method: 'DELETE',
      headers: {
        'X-HELM-Active-Tenant': tenantId,
      },
    })
    if (res.ok) return true
  } catch {
    // fallback
  }

  return memoryThreads.delete(threadId)
}

export async function appendMessageToThread(
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
  model?: string,
  citations?: any[],
  grounded?: boolean,
  tenantId = 'letstute',
): Promise<WorkspaceMessage> {
  try {
    const res = await fetch(`${HELM_API_BASE_URL}/api/v1/workspace/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HELM-Active-Tenant': tenantId,
      },
      body: JSON.stringify({
        role,
        content,
        model,
        citations,
        grounded,
      }),
    })
    if (res.ok) {
      const m = await res.json()
      return {
        id: m.id,
        threadId: m.thread_id,
        role: m.role,
        content: m.content,
        model: m.model,
        citations: m.citations,
        grounded: m.grounded,
        tokensIn: m.tokens_in,
        tokensOut: m.tokens_out,
        costMicros: m.cost_micros,
        createdAt: m.created_at,
      }
    }
  } catch {
    // fallback
  }

  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const now = new Date().toISOString()
  const msg: WorkspaceMessage = {
    id,
    threadId,
    role,
    content,
    model,
    citations,
    grounded,
    createdAt: now,
  }
  const thread = memoryThreads.get(threadId)
  if (thread) {
    if (!thread.messages) thread.messages = []
    thread.messages.push(msg)
    thread.updatedAt = now
    thread.lastMessagePreview = content.slice(0, 80)
    thread.messageCount = thread.messages.length
  }
  return msg
}

export async function fetchRunSteps(runId: string, tenantId = 'letstute'): Promise<any[]> {
  try {
    const res = await fetch(`${HELM_API_BASE_URL}/api/v1/agents/runs/${runId}/steps`, {
      headers: {
        'X-HELM-Active-Tenant': tenantId,
      },
      cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      return data.steps || []
    }
  } catch {
    // fallback
  }
  return []
}
