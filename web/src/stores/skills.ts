import { create } from 'zustand'
import { authFetch } from '../lib/api'
import { saveEntity, duplicateEntity } from './utils'

export type SkillSource =
  | 'bundled'
  | 'global-shared'
  | 'global-openfox'
  | 'selected'
  | 'project-shared'
  | 'project-openfox'

export interface SelectedSkillDirectory {
  configuredPath: string
  resolvedPath: string | null
  available: boolean
  custom: boolean
}

export interface SkillInfo {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
  source: SkillSource
  path: string | null
  legacy: boolean
  readOnly: boolean
  warnings: string[]
}

export interface SkillFull {
  metadata: { id: string; name: string; description: string; version: string }
  prompt: string
}

interface SkillsState {
  defaults: SkillInfo[]
  userItems: SkillInfo[]
  projectItems: SkillInfo[]
  items: SkillInfo[]
  selectedDirectory: SelectedSkillDirectory | null
  diagnostics: string[]
  loading: boolean
  workdir: string | null
  setWorkdir: (workdir: string | null) => void
  fetchSkills: (workdir?: string | null) => Promise<void>
  toggleSkill: (skillId: string) => Promise<void>
  fetchSkill: (skillId: string) => Promise<SkillFull | null>
  fetchDefaultContent: (skillId: string) => Promise<SkillFull | null>
  createSkill: (skill: SkillFull, destination?: 'project' | 'user') => Promise<{ success: boolean; error?: string }>
  updateSkill: (id: string, skill: Partial<SkillFull>) => Promise<{ success: boolean; error?: string }>
  deleteSkill: (skillId: string) => Promise<{ success: boolean; error?: string; reason?: string }>
  duplicateSkill: (skillId: string, destination?: 'project' | 'user') => Promise<{ success: boolean; error?: string }>
  selectDirectory: (path: string) => Promise<{ success: boolean; error?: string }>
  removeDirectory: () => Promise<void>
  installSkill: (skillPackage: {
    packageName: string
    files: Array<{ path: string; file: File }>
  }) => Promise<{ success: boolean; error?: string }>
}

async function mutateSkills(
  url: string,
  init: RequestInit,
  refresh: () => Promise<void>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(url, init)
    if (!response.ok) return { success: false, error: ((await response.json()) as { error?: string }).error }
    await refresh()
    return { success: true }
  } catch {
    return { success: false, error: 'Network error' }
  }
}

function skillsUrl(path: string, workdir?: string | null): string {
  if (workdir) return `${path}?workdir=${encodeURIComponent(workdir)}`
  return path
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  defaults: [],
  userItems: [],
  projectItems: [],
  items: [],
  selectedDirectory: null,
  diagnostics: [],
  loading: false,
  workdir: null,

  setWorkdir: (workdir) => {
    set({ workdir })
  },

  fetchSkills: async (workdir?: string | null) => {
    const wd = workdir ?? get().workdir
    set({ loading: true })
    try {
      const res = await authFetch(skillsUrl('/api/skills', wd))
      const data = await res.json()
      set({
        defaults: data.defaults ?? [],
        userItems: data.userItems ?? [],
        projectItems: data.projectItems ?? [],
        items: data.items ?? [],
        selectedDirectory: data.selectedDirectory ?? null,
        diagnostics: data.diagnostics ?? [],
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },

  toggleSkill: async (skillId: string) => {
    try {
      const res = await authFetch(skillsUrl(`/api/skills/${skillId}/toggle`, get().workdir), { method: 'POST' })
      const data = await res.json()
      set((state) => ({
        defaults: state.defaults.map((s) => (s.id === skillId ? { ...s, enabled: data.enabled } : s)),
        userItems: state.userItems.map((s) => (s.id === skillId ? { ...s, enabled: data.enabled } : s)),
        projectItems: state.projectItems.map((s) => (s.id === skillId ? { ...s, enabled: data.enabled } : s)),
        items: state.items.map((s) => (s.id === skillId ? { ...s, enabled: data.enabled } : s)),
      }))
    } catch {
      // silently fail
    }
  },

  fetchSkill: async (skillId: string) => {
    try {
      const res = await authFetch(skillsUrl(`/api/skills/${skillId}`, get().workdir))
      if (!res.ok) return null
      return (await res.json()) as SkillFull
    } catch {
      return null
    }
  },

  fetchDefaultContent: async (skillId: string) => {
    try {
      const res = await authFetch(`/api/skills/defaults/${skillId}`)
      if (!res.ok) return null
      return (await res.json()) as SkillFull
    } catch {
      return null
    }
  },

  createSkill: async (skill: SkillFull, destination?: 'project' | 'user') => {
    const result = await saveEntity('POST', skillsUrl('/api/skills', get().workdir), {
      ...skill,
      destination,
    } as unknown as Record<string, unknown>)
    if (result.success) await get().fetchSkills()
    return result
  },

  updateSkill: async (id: string, skill: Partial<SkillFull>) => {
    const result = await saveEntity(
      'PUT',
      skillsUrl(`/api/skills/${id}`, get().workdir),
      skill as unknown as Record<string, unknown>,
    )
    if (result.success) await get().fetchSkills()
    return result
  },

  deleteSkill: async (skillId: string) => {
    try {
      const res = await authFetch(skillsUrl(`/api/skills/${skillId}`, get().workdir), { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        set((state) => ({
          userItems: state.userItems.filter((s) => s.id !== skillId),
        }))
        return { success: true }
      }
      return { success: false, error: data.error ?? 'Failed to delete' }
    } catch {
      return { success: false, error: 'Network error' }
    }
  },

  duplicateSkill: async (skillId: string, destination?: 'project' | 'user') => {
    return duplicateEntity(
      skillsUrl(`/api/skills/${skillId}/duplicate`, get().workdir),
      () => get().fetchSkills(),
      destination,
    )
  },

  selectDirectory: async (path) => {
    return mutateSkills(
      '/api/skills/library',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      },
      get().fetchSkills,
    )
  },

  removeDirectory: async () => {
    await authFetch('/api/skills/library', { method: 'DELETE' })
    await get().fetchSkills()
  },

  installSkill: async (skillPackage) => {
    const body = new FormData()
    body.append('packageName', skillPackage.packageName)
    body.append('paths', JSON.stringify(skillPackage.files.map((file) => file.path)))
    for (const file of skillPackage.files) body.append('files', file.file, file.file.name)
    return mutateSkills('/api/skills/install', { method: 'POST', body }, get().fetchSkills)
  },
}))
