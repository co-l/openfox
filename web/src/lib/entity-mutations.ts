import { authFetch } from './api'

export const saveEntity = async (
  method: 'POST' | 'PUT',
  url: string,
  entity: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entity),
    })
    if (!res.ok) {
      const data = await res.json()
      return { success: false, error: data.error }
    }
    return { success: true }
  } catch {
    return { success: false, error: 'Network error' }
  }
}

export const duplicateEntity = async (
  url: string,
  fetchFn: () => Promise<void>,
  destination?: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const res = await authFetch(url, {
      method: 'POST',
      body: destination ? JSON.stringify({ destination }) : undefined,
      headers: destination ? { 'Content-Type': 'application/json' } : undefined,
    })
    const data = await res.json()
    if (res.ok) {
      await fetchFn()
      return { success: true }
    }
    return { success: false, error: data.error ?? 'Failed to duplicate' }
  } catch {
    return { success: false, error: 'Network error' }
  }
}
