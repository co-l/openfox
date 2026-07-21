import { create } from 'zustand'
import { appUrl } from '../lib/basePath'

type UpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'error'

interface UpdateState {
  status: UpdateStatus
  current: string | null
  latest: string | null
  check: (force?: boolean) => Promise<void>
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  current: null,
  latest: null,

  check: async (force?: boolean) => {
    if (!force && get().status === 'checking') return
    set({ status: 'checking' })
    try {
      const res = await fetch(appUrl(`/api/auto-update/check${force ? '?force=true' : ''}`))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { isUpdateAvailable: boolean; current: string; latest: string }
      set({
        status: data.isUpdateAvailable ? 'available' : 'upToDate',
        current: data.current,
        latest: data.latest,
      })
    } catch {
      set({ status: 'error' })
    }
  },
}))
