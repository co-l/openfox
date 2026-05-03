import type { Project } from '../../shared/types.js'
import { getDatabase } from './index.js'

// ============================================================================
// Project Operations
// ============================================================================

export function createProject(name: string, workdir: string): Project {
  const db = getDatabase()
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
  updates: { name?: string; customInstructions?: string | null },
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

// ============================================================================
// Row Types
// ============================================================================

interface ProjectRow {
  id: string
  name: string
  workdir: string
  custom_instructions: string | null
  created_at: string
  updated_at: string
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    workdir: row.workdir,
    ...(row.custom_instructions ? { customInstructions: row.custom_instructions } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
