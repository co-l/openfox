import { create } from 'zustand'
import { authFetch } from '../lib/api'
import type { QuotaReport } from '@shared/types'

interface QuotaState {
  report: QuotaReport | null
  loading: boolean
  error: string | null
  lastFetched: number | null
  fetchQuota: () => Promise<void>
}

export const useQuotaStore = create<QuotaState>((set, get) => ({
  report: null,
  loading: false,
  error: null,
  lastFetched: null,
  fetchQuota: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const res = await authFetch('/api/quota')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const report = (await res.json()) as QuotaReport
      set({ report, loading: false, lastFetched: Date.now() })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load quota', loading: false })
    }
  },
}))
