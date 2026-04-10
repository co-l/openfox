export function getSessionToken(): string | null {
  return sessionStorage.getItem('openfox_token')
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = sessionStorage.getItem('openfox_token')
  const headers = {
    ...(options.headers instanceof Headers ? Object.fromEntries(options.headers.entries()) : options.headers),
    ...(token ? { 'x-session-token': token } : {}),
  }

  return fetch(url, { ...options, headers })
}