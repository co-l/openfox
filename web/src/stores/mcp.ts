import { create } from 'zustand'
import { authFetch } from '../lib/api'

export interface McpToolInfo {
  name: string
  description?: string
  enabled: boolean
  estimatedTokens: number
}

export interface McpServerInfo {
  name: string
  status: string
  tools: McpToolInfo[]
  estimatedTokens: number
  config: {
    transport?: string
    command?: string
    args?: string[]
    url?: string
    disabled?: boolean
  }
}

interface McpStore {
  servers: McpServerInfo[]
  setServers: (servers: McpServerInfo[]) => void
  fetchServers: () => Promise<void>
}

export const useMcpStore = create<McpStore>((set) => ({
  servers: [],
  setServers: (servers) => set({ servers }),
  fetchServers: async () => {
    try {
      const res = await authFetch('/api/mcp/servers')
      if (!res.ok) return
      const data = await res.json()
      const sorted = (data.servers ?? []).sort((a: McpServerInfo, b: McpServerInfo) => a.name.localeCompare(b.name))
      set({ servers: sorted })
    } catch {
      // ignore
    }
  },
}))
