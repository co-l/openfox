import { create } from 'zustand'
import { authFetch } from '../lib/api'
import { saveEntity } from './utils'
import { fetchItems } from './fetch-items'

export interface SkillInfo {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
}

export interface SkillFull {
  metadata: { id: string; name: string; description: string; version: string }
  prompt: string
}

interface SkillsState {
  defaults: SkillInfo[]
  userItems: SkillInfo[]
  loading: boolean
  fetchSkills: () => Promise<void>
  toggleSkill: (skillId: string) => Promise<void>
  fetchSkill: (skillId: string) => Promise<SkillFull | null>
  fetchDefaultContent: (skillId: string) => Promise<SkillFull | null>
  createSkill: (skill: SkillFull) => Promise<{ success: boolean; error?: string }>
  updateSkill: (id: string, skill: Partial<SkillFull>) => Promise<{ success: boolean; error?: string }>
  deleteSkill: (skillId: string) => Promise<{ success: boolean; error?: string; reason?: string }>
  duplicateSkill: (skillId: string) => Promise<{ success: boolean; error?: string }>
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  defaults: [],
  userItems: [],
  loading: false,

  fetchSkills: async () => {
    await fetchItems('/api/skills', set as unknown as (partial: unknown) => void)
  },

  toggleSkill: async (skillId: string) => {
    try {
      const res = await authFetch(`/api/skills/${skillId}/toggle`, { method: 'POST' })
      const data = await res.json()
      set(state => ({
        defaults: state.defaults.map(s => s.id === skillId ? { ...s, enabled: data.enabled } : s),
        userItems: state.userItems.map(s => s.id === skillId ? { ...s, enabled: data.enabled } : s),
      }))
    } catch {
      // silently fail
    }
  },

  fetchSkill: async (skillId: string) => {
    try {
      const res = await authFetch(`/api/skills/${skillId}`)
      if (!res.ok) return null
      return await res.json() as SkillFull
    } catch {
      return null
    }
  },

  fetchDefaultContent: async (skillId: string) => {
    try {
      const res = await authFetch(`/api/skills/defaults/${skillId}`)
      if (!res.ok) return null
      return await res.json() as SkillFull
    } catch {
      return null
    }
  },

  createSkill: async (skill: SkillFull) => {
    const result = await saveEntity('POST', '/api/skills', skill as unknown as Record<string, unknown>)
    if (result.success) await get().fetchSkills()
    return result
  },

  updateSkill: async (id: string, skill: Partial<SkillFull>) => {
    const result = await saveEntity('PUT', `/api/skills/${id}`, skill as unknown as Record<string, unknown>)
    if (result.success) await get().fetchSkills()
    return result
  },

  deleteSkill: async (skillId: string) => {
    try {
      const res = await authFetch(`/api/skills/${skillId}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        set(state => ({
          userItems: state.userItems.filter(s => s.id !== skillId),
        }))
        return { success: true }
      }
      return { success: false, error: data.error ?? 'Failed to delete' }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  duplicateSkill: async (skillId: string) => {
    try {
      const res = await authFetch(`/api/skills/${skillId}/duplicate`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        await get().fetchSkills()
        return { success: true }
      }
      return { success: false, error: data.error ?? 'Failed to duplicate' }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },
}))