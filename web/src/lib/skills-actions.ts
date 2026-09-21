import { authFetch } from './api'
import { saveEntity, duplicateEntity } from './entity-mutations'
import { skillsResource, skillResource, scopedUrl } from './resources'

export type SkillSource =
  'bundled' | 'global-shared' | 'global-openfox' | 'selected' | 'project-shared' | 'project-openfox'

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

export async function toggleSkill(skillId: string, workdir?: string | null): Promise<void> {
  try {
    await authFetch(scopedUrl(`/api/skills/${skillId}/toggle`, workdir ?? undefined), { method: 'POST' })
    await skillsResource.refresh(workdir ?? undefined)
  } catch {
    // silently fail
  }
}

export async function createSkill(
  skill: SkillFull,
  destination?: 'project' | 'user',
  workdir?: string | null,
): Promise<{ success: boolean; error?: string }> {
  const result = await saveEntity('POST', scopedUrl('/api/skills', workdir ?? undefined), {
    ...skill,
    destination,
  } as unknown as Record<string, unknown>)
  if (result.success) await skillsResource.refresh(workdir ?? undefined)
  return result
}

export async function updateSkill(
  id: string,
  skill: Partial<SkillFull>,
  workdir?: string | null,
): Promise<{ success: boolean; error?: string }> {
  const result = await saveEntity(
    'PUT',
    scopedUrl(`/api/skills/${id}`, workdir ?? undefined),
    skill as unknown as Record<string, unknown>,
  )
  if (result.success) {
    await skillsResource.refresh(workdir ?? undefined)
    skillResource.invalidate(id, workdir ?? undefined)
  }
  return result
}

export async function deleteSkill(
  skillId: string,
  workdir?: string | null,
): Promise<{ success: boolean; error?: string; reason?: string }> {
  try {
    const res = await authFetch(scopedUrl(`/api/skills/${skillId}`, workdir ?? undefined), { method: 'DELETE' })
    const data = await res.json()
    if (res.ok) {
      await skillsResource.refresh(workdir ?? undefined)
      skillResource.invalidate(skillId, workdir ?? undefined)
      return { success: true }
    }
    return { success: false, error: data.error ?? 'Failed to delete' }
  } catch {
    return { success: false, error: 'Network error' }
  }
}

export async function duplicateSkill(
  skillId: string,
  destination?: 'project' | 'user',
  workdir?: string | null,
): Promise<{ success: boolean; error?: string }> {
  return duplicateEntity(
    scopedUrl(`/api/skills/${skillId}/duplicate`, workdir ?? undefined),
    async () => {
      await skillsResource.refresh(workdir ?? undefined)
    },
    destination,
  )
}

export async function selectDirectory(
  path: string,
  workdir?: string | null,
): Promise<{ success: boolean; error?: string }> {
  return mutateSkills(
    '/api/skills/library',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    },
    async () => {
      await skillsResource.refresh(workdir ?? undefined)
    },
  )
}

export async function removeDirectory(workdir?: string | null): Promise<void> {
  await authFetch('/api/skills/library', { method: 'DELETE' })
  await skillsResource.refresh(workdir ?? undefined)
}

export async function installSkill(
  skillPackage: {
    packageName: string
    files: Array<{ path: string; file: File }>
  },
  workdir?: string | null,
): Promise<{ success: boolean; error?: string }> {
  const body = new FormData()
  body.append('packageName', skillPackage.packageName)
  body.append('paths', JSON.stringify(skillPackage.files.map((file) => file.path)))
  for (const file of skillPackage.files) body.append('files', file.file, file.file.name)
  return mutateSkills('/api/skills/install', { method: 'POST', body }, async () => {
    await skillsResource.refresh(workdir ?? undefined)
  })
}
