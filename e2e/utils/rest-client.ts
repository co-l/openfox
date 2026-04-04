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

/**
 * Set session mode via REST API and optionally reload via WS
 */
export async function setSessionMode(
  baseUrl: string,
  sessionId: string,
  mode: 'planner' | 'builder',
  wsUrl?: string
): Promise<{ session: Session; messages: unknown[] }> {
  const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/mode`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(error.error || `Failed to set session mode: ${response.status}`)
  }

  const result = response.json() as Promise<{ session: Session; messages: unknown[] }>

  // If WS URL provided, briefly connect to trigger event subscription
  // This ensures the mode.changed event gets broadcast to subscribers
  if (wsUrl) {
    const wsBaseUrl = wsUrl.split('?')[0]!
    const ws = new (await import('ws')).default(wsBaseUrl)
    try {
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ id: 'sub', type: 'session.load', payload: { sessionId } }))
          setTimeout(() => resolve(), 500) // Brief delay to receive events
        })
        ws.on('error', () => {
          // Ignore connection errors - we're just triggering subscription
          resolve()
        })
        setTimeout(() => reject(new Error('Timeout')), 3000)
      })
    } catch {
      // Timeout is OK - we just needed to trigger the subscription briefly
    } finally {
      ws.close()
    }
  }

  return result
}

/**
 * Set session criteria via REST API
 */
export async function setSessionCriteria(
  baseUrl: string,
  sessionId: string,
  criteria: unknown[]
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/criteria`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ criteria }),
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(error.error || `Failed to set criteria: ${response.status}`)
  }
}

/**
 * Stop session chat via REST API
 */
export async function stopSessionChat(
  baseUrl: string,
  sessionId: string
): Promise<{ success: boolean }> {
  const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(error.error || `Failed to stop session: ${response.status}`)
  }

  return response.json() as Promise<{ success: boolean }>
}

/**
 * Continue session chat via REST API
 */
export async function continueSessionChat(
  baseUrl: string,
  sessionId: string
): Promise<{ accepted: boolean }> {
  const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/continue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(error.error || `Failed to continue session: ${response.status}`)
  }

  return response.json() as Promise<{ accepted: boolean }>
}
