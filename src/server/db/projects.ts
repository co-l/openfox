import type { Project } from '../../shared/types.js'
import { getDatabase } from './index.js'

// ============================================================================
// Project Operations
// ============================================================================

export function createProject(name: string, workdir: string): Project {
  const db = getDatabase()

  // If project with this workdir already exists, return it idempotently
  const existing = getProjectByWorkdir(workdir)
  if (existing) {
    return existing
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  db.prepare(
    `
    INSERT INTO projects (id, name, workdir, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(id, name, workdir, now, now)

  return {
    id,
    name,
    workdir,
    createdAt: now,
    updatedAt: now,
  }
}

export function getProject(id: string): Project | null {
  const db = getDatabase()

  const row = db
    .prepare(
      `
    SELECT * FROM projects WHERE id = ?
  `,
    )
    .get(id) as ProjectRow | undefined

  if (!row) {
    return null
  }

  return rowToProject(row)
}

export function getProjectByWorkdir(workdir: string): Project | null {
  const db = getDatabase()

  const row = db
    .prepare(
      `
    SELECT * FROM projects WHERE workdir = ?
  `,
    )
    .get(workdir) as ProjectRow | undefined

  if (!row) {
    return null
  }

  return rowToProject(row)
}

export function listProjects(): Project[] {
  const db = getDatabase()

  const rows = db
    .prepare(
      `
    SELECT * FROM projects ORDER BY updated_at DESC
  `,
    )
    .all() as ProjectRow[]

  return rows.map(rowToProject)
}

export function updateProject(
  id: string,
  updates: {
    name?: string
    customInstructions?: string | null
    dangerLevel?: DangerLevel | null
    defaultAgent?: string | null
    workspaceRootDir?: string | null
    mcpOverrides?: Record<string, { disabled?: boolean; disabledTools?: string[] }> | null
  },
): Project | null {
  const db = getDatabase()
  const now = new Date().toISOString()

  const sets: string[] = ['updated_at = ?']
  const values: (string | null)[] = [now]

  if (updates.name !== undefined) {
    sets.push('name = ?')
    values.push(updates.name)
  }

  if (updates.customInstructions !== undefined) {
    sets.push('custom_instructions = ?')
    values.push(updates.customInstructions)
  }

  if (updates.dangerLevel !== undefined) {
    sets.push('danger_level = ?')
    values.push(updates.dangerLevel)
  }

  if (updates.defaultAgent !== undefined) {
    sets.push('default_agent = ?')
    values.push(updates.defaultAgent)
  }

  if (updates.workspaceRootDir !== undefined) {
    sets.push('workspace_root_dir = ?')
    values.push(updates.workspaceRootDir)
  }

  if (updates.mcpOverrides !== undefined) {
    sets.push('mcp_overrides = ?')
    values.push(updates.mcpOverrides !== null ? JSON.stringify(updates.mcpOverrides) : null)
  }

  values.push(id)

  const result = db
    .prepare(
      `
    UPDATE projects SET ${sets.join(', ')} WHERE id = ?
  `,
    )
    .run(...values)

  // Check if any row was updated
  if (result.changes === 0) {
    return null
  }

  return getProject(id)
}

export function deleteProject(id: string): void {
  const db = getDatabase()
  // Sessions will be cascade deleted due to foreign key
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

export function toggleStar(id: string, isStarred: boolean): Project | null {
  const db = getDatabase()
  db.prepare('UPDATE projects SET is_starred = ? WHERE id = ?').run(isStarred ? 1 : 0, id)
  return getProject(id)
}

export function getProjectDefaultAgent(projectId: string): string | null {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT default_agent FROM projects WHERE id = ?').get(projectId) as
      { default_agent: string | null } | undefined
    return row?.default_agent ?? null
  } catch {
    return null
  }
}

// ============================================================================
// Row Types
// ============================================================================

interface ProjectRow {
  id: string
  name: string
  workdir: string
  custom_instructions: string | null
  danger_level: string | null
  default_agent: string | null
  is_starred: number
  workspace_root_dir: string | null
  mcp_overrides: string | null
  created_at: string
  updated_at: string
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    workdir: row.workdir,
    ...(row.custom_instructions ? { customInstructions: row.custom_instructions } : {}),
    ...(row.danger_level ? { dangerLevel: row.danger_level as DangerLevel } : {}),
    ...(row.default_agent ? { defaultAgent: row.default_agent } : {}),
    isStarred: !!row.is_starred,
    ...(row.workspace_root_dir ? { workspaceRootDir: row.workspace_root_dir } : {}),
    ...(row.mcp_overrides
      ? {
          mcpOverrides: JSON.parse(row.mcp_overrides) as Record<
            string,
            { disabled?: boolean; disabledTools?: string[] }
          >,
        }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type DangerLevel = 'normal' | 'dangerous'
