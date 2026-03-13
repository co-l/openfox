import { create } from 'zustand'
import type { VllmMetrics, Diagnostic } from '@openfox/shared'

interface MetricsState {
  vllmMetrics: VllmMetrics | null
  derived: {
    prefillSpeed: number
    generationSpeed: number
    contextPercent: number
    cacheHealth: 'good' | 'pressure' | 'critical'
  } | null
  diagnostics: Map<string, Diagnostic[]>
  
  setMetrics: (metrics: VllmMetrics, derived: MetricsState['derived']) => void
  setDiagnostics: (path: string, diagnostics: Diagnostic[]) => void
  clearDiagnostics: () => void
}

export const useMetricsStore = create<MetricsState>((set) => ({
  vllmMetrics: null,
  derived: null,
  diagnostics: new Map(),
  
  setMetrics: (metrics, derived) => {
    set({ vllmMetrics: metrics, derived })
  },
  
  setDiagnostics: (path, diagnostics) => {
    set(state => {
      const newDiagnostics = new Map(state.diagnostics)
      newDiagnostics.set(path, diagnostics)
      return { diagnostics: newDiagnostics }
    })
  },
  
  clearDiagnostics: () => {
    set({ diagnostics: new Map() })
  },
}))
