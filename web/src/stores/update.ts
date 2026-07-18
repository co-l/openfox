import { create } from 'zustand'

type UpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'error'

interface UpdateState {
  status: UpdateStatus
  current: string | null
  latest: string | null
  check: () => Promise<void>
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  current: null,
  latest: null,

  check: async () => {
    if (get().status === 'checking') return
    set({ status: 'checking' })
    try {
      const res = await fetch('/api/auto-update/check')
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
