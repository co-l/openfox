/**
 * REST API client for E2E tests.
 * 
 * Provides helper functions for creating projects and sessions via REST API.
 */

export interface Project {
  id: string
  name: string
  workdir: string
  createdAt: string
  updatedAt: string
}

export interface Session {
  id: string
  projectId: string
  workdir: string
  mode: 'planner' | 'builder'
  phase: 'plan' | 'build' | 'verification' | 'done' | 'blocked'
  isRunning: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateProjectOptions {
  name: string
  workdir?: string
}

export interface CreateSessionOptions {
  projectId: string
  title?: string
}

/**
 * Create a project via REST API
 */
export async function createProject(
  baseUrl: string,
  options: CreateProjectOptions
): Promise<Project> {
  const response = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
  
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(error.error || `Failed to create project: ${response.status}`)
  }
  
  const data = await response.json() as { project: Project }
  return data.project
}

/**
 * Create a session via REST API
 */
export async function createSession(
  baseUrl: string,
  options: CreateSessionOptions
): Promise<Session> {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
  
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(error.error || `Failed to create session: ${response.status}`)
  }
  
  const data = await response.json() as { session: Session }
  return data.session
}

/**
 * Get a project via REST API
 */
export async function getProject(baseUrl: string, projectId: string): Promise<Project> {
  const response = await fetch(`${baseUrl}/api/projects/${projectId}`)
  
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(error.error || `Failed to get project: ${response.status}`)
  }
  
  const data = await response.json() as { project: Project }
  return data.project
}

/**
 * List projects via REST API
 */
export async function listProjects(baseUrl: string): Promise<Project[]> {
  const response = await fetch(`${baseUrl}/api/projects`)
  
  if (!response.ok) {
    throw new Error(`Failed to list projects: ${response.status}`)
  }
  
  const data = await response.json() as { projects?: Project[] }
  return data.projects ?? []
}

/**
 * List sessions for a project via REST API
 */
export async function listSessions(baseUrl: string, projectId: string): Promise<Session[]> {
  const response = await fetch(`${baseUrl}/api/projects/${projectId}/sessions`)
  
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.status}`)
  }
  
  const data = await response.json() as { sessions?: Session[] }
  return data.sessions ?? []
}

/**
 * Get a setting via REST API
 */
export async function getSetting(baseUrl: string, key: string): Promise<string | null> {
  const response = await fetch(`${baseUrl}/api/settings/${key}`)
  
  if (!response.ok) {
    return null
  }
  
  const data = await response.json() as { value?: string }
  return data.value ?? null
}

/**
 * Set a setting via REST API
 */
export async function setSetting(
  baseUrl: string,
  key: string,
  value: string
): Promise<string | null> {
  const response = await fetch(`${baseUrl}/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  
  if (!response.ok) {
    return null
  }
  
  const data = await response.json() as { value?: string }
  return data.value ?? null
}
