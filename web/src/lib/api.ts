export function getSessionToken(): string | null {
  return localStorage.getItem('openfox_token')
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('openfox_token')
  const headers = {
    ...(options.headers instanceof Headers ? Object.fromEntries(options.headers.entries()) : options.headers),
    ...(token ? { 'x-session-token': token } : {}),
  }

  return fetch(url, { ...options, headers })
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
