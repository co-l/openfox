import { create } from 'zustand'
import { authFetch } from '../lib/api'

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
  skills: SkillInfo[]
  defaultIds: string[]
  modifiedIds: string[]
  loading: boolean
  fetchSkills: () => Promise<void>
  fetchDefaultIds: () => Promise<void>
  toggleSkill: (skillId: string) => Promise<void>
  fetchSkill: (skillId: string) => Promise<SkillFull | null>
  createSkill: (skill: SkillFull) => Promise<{ success: boolean; error?: string }>
  updateSkill: (id: string, skill: Partial<SkillFull>) => Promise<{ success: boolean; error?: string }>
  deleteSkill: (skillId: string) => Promise<boolean>
  restoreDefault: (skillId: string) => Promise<boolean>
  restoreAllDefaults: () => Promise<boolean>
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  defaultIds: [],
  modifiedIds: [],
  loading: false,

  fetchDefaultIds: async () => {
    try {
      const res = await authFetch('/api/skills/default-ids')
      const data = await res.json()
      set({ defaultIds: data.ids ?? [] })
    } catch { /* ignore */ }
  },

  fetchSkills: async () => {
    set({ loading: true })
    try {
      const res = await authFetch('/api/skills')
      const data = await res.json()
      set({
        skills: data.skills ?? [],
        defaultIds: data.defaultIds ?? get().defaultIds,
        modifiedIds: data.modifiedIds ?? [],
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },

  toggleSkill: async (skillId: string) => {
    try {
      const res = await authFetch(`//skills/${skillId}/toggle`, { method: 'POST' })
      const data = await res.json()
      set({
        skills: get().skills.map(s =>
          s.id === skillId ? { ...s, enabled: data.enabled } : s
        ),
      })
    } catch {
      // silently fail
    }
  },

  fetchSkill: async (skillId: string) => {
    try {
      const res = await authFetch(`//skills/${skillId}`)
      if (!res.ok) return null
      return await res.json() as SkillFull
    } catch {
      return null
    }
  },

  createSkill: async (skill: SkillFull) => {
    try {
      const res = await authFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skill),
      })
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      await get().fetchSkills()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  updateSkill: async (id: string, skill: Partial<SkillFull>) => {
    try {
      const res = await authFetch(`//skills/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skill),
      })
      if (!res.ok) {
        const data = await res.json()
        return { success: false, error: data.error }
      }
      await get().fetchSkills()
      return { success: true }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  deleteSkill: async (skillId: string) => {
    try {
      const res = await authFetch(`//skills/${skillId}`, { method: 'DELETE' })
      if (res.ok) {
        set({ skills: get().skills.filter(s => s.id !== skillId) })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  restoreDefault: async (skillId: string) => {
    try {
      const res = await authFetch(`//skills/${skillId}/restore-default`, { method: 'POST' })
      if (res.ok) {
        await get().fetchSkills()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  restoreAllDefaults: async () => {
    try {
      const res = await authFetch('/api/skills/restore-all-defaults', { method: 'POST' })
      if (res.ok) {
        await get().fetchSkills()
        return true
      }
      return false
    } catch {
      return false
    }
  },
}))
