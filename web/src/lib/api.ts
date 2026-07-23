import { appUrl } from './basePath'

export function getSessionToken(): string | null {
  return localStorage.getItem('openfox_token')
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('openfox_token')
  const headers = {
    ...(options.headers instanceof Headers ? Object.fromEntries(options.headers.entries()) : options.headers),
    ...(token ? { 'x-session-token': token } : {}),
  }

  return fetch(appUrl(url), { ...options, headers })
}

export async function truncateSession(sessionId: string, messageIndex: number): Promise<boolean> {
  try {
    const res = await authFetch(`/api/sessions/${sessionId}/truncate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageIndex }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function replayMessage(sessionId: string, messageId: string, content?: string): Promise<boolean> {
  try {
    const res = await authFetch(`/api/sessions/${sessionId}/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, ...(content !== undefined ? { content } : {}) }),
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
