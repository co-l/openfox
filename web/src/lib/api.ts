import { appUrl } from './basePath'
import type { Attachment } from '@shared/types.js'

export function getSessionToken(): string | null {
  return localStorage.getItem('openfox_token')
}

export function hasStoredToken(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('openfox_token') !== null
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('openfox_token')
  const headers = {
    ...(options.headers instanceof Headers ? Object.fromEntries(options.headers.entries()) : options.headers),
    ...(token ? { 'x-session-token': token } : {}),
  }

  return fetch(appUrl(url), { ...options, headers })
}

export interface ConversationTreeTip {
  eventId: string
  timestamp: number
  type: string
  preview?: string
  role?: string
}

export interface ConversationTreeNode {
  eventId: string
  parentId: string | null
  seq: number
  timestamp: number
  type: string
  messageId?: string
  role?: string
  preview?: string
}

export interface ConversationTree {
  treeId: string
  cursor: string | null
  tips: ConversationTreeTip[]
  nodes: ConversationTreeNode[]
}

export async function getConversationTree(sessionId: string): Promise<ConversationTree | null> {
  try {
    const res = await authFetch(`/api/sessions/${sessionId}/conversation-tree`)
    if (!res.ok) return null
    return (await res.json()) as ConversationTree
  } catch {
    return null
  }
}

export async function switchConversationBranch(sessionId: string, messageId: string): Promise<boolean> {
  try {
    const res = await authFetch(`/api/sessions/${sessionId}/conversation-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function replayMessage(
  sessionId: string,
  messageId: string,
  content?: string,
  attachments?: Attachment[],
): Promise<boolean> {
  try {
    const res = await authFetch(`/api/sessions/${sessionId}/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId,
        ...(content !== undefined ? { content } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

export interface ForkSessionResult {
  session: import('@shared/types.js').Session
}

export async function forkSession(
  sessionId: string,
  messageId: string,
  title?: string,
): Promise<ForkSessionResult | null> {
  try {
    const res = await authFetch(`/api/sessions/${sessionId}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, ...(title !== undefined ? { title } : {}) }),
    })
    if (!res.ok) return null
    return (await res.json()) as ForkSessionResult
  } catch {
    return null
  }
}

export interface SessionExportDocument {
  format?: string
  session?: { title?: string }
}

/**
 * Fetch a session export and trigger a browser download of the JSON document.
 * Returns false when the export failed.
 */
export async function downloadSessionExport(sessionId: string, fallbackTitle?: string): Promise<boolean> {
  try {
    const res = await authFetch(`/api/sessions/${sessionId}/export`)
    if (!res.ok) return false
    const payload = (await res.json()) as SessionExportDocument
    const title = payload.session?.title ?? fallbackTitle ?? 'session'
    const filename = `${title.replace(/[^a-zA-Z0-9-_]+/g, '_')}.openfox-session.json`
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

export type ImportSessionOutcome =
  { ok: true; session: import('@shared/types.js').Session } | { ok: false; error: string }

export async function importSession(projectId: string, payload: unknown): Promise<ImportSessionOutcome> {
  try {
    const res = await authFetch(`/api/sessions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, payload }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      session?: import('@shared/types.js').Session
      error?: string
    }
    if (!res.ok || !body.session) {
      return { ok: false, error: body.error ?? 'Import failed' }
    }
    return { ok: true, session: body.session }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}
