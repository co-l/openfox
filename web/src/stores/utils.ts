import { authFetch } from '../lib/api'

export const saveEntity = async (
  method: 'POST' | 'PUT',
  url: string,
  entity: Record<string, unknown>
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

export function createLogBuffer(flushFn: () => void) {
  let logRafId: number | null = null

  function scheduleLogFlush() {
    if (logRafId !== null) return
    logRafId = requestAnimationFrame(() => {
      logRafId = null
      flushFn()
    })
  }

  return scheduleLogFlush
}