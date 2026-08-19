/**
 * Team Routes
 *
 * Teams are named per-step model bundles stored in DB settings. A workflow
 * binds to a team via `/api/teams/bindings/:workflowId`; the executor then
 * resolves each step's model from the team (precedence: step override > team
 * > agent override > session).
 */

import { Router } from 'express'
import { getTeams, getTeam, setTeam, getWorkflowTeam, setWorkflowTeam } from '../agents/teams.js'
import type { Team } from '../agents/teams.js'
import { isReasoningEffortValue } from '../providers/model-catalog.js'

function validateAssignments(assignments: unknown): string | null {
  if (assignments === undefined) return null
  if (typeof assignments !== 'object' || assignments === null || Array.isArray(assignments))
    return 'assignments must be an object'
  for (const [stepId, a] of Object.entries(assignments as Record<string, unknown>)) {
    if (typeof a !== 'object' || a === null) return `assignment for '${stepId}' must be an object`
    const { providerId, model, reasoningEffort } = a as Record<string, unknown>
    if (typeof providerId !== 'string' || !providerId) return `assignment '${stepId}' missing providerId`
    if (typeof model !== 'string' || !model) return `assignment '${stepId}' missing model`
    if (reasoningEffort !== undefined && !isReasoningEffortValue(String(reasoningEffort)))
      return `assignment '${stepId}' has unsupported reasoningEffort`
  }
  return null
}

export function createTeamRoutes(): Router {
  const router = Router()

  // --- Team CRUD ---

  router.get('/', (_req, res) => {
    res.json({ teams: getTeams() })
  })

  router.get('/:id', (req, res) => {
    const team = getTeam(req.params.id)
    if (!team) return res.status(404).json({ error: 'Team not found' })
    res.json(team)
  })

  router.put('/:id', (req, res) => {
    const id = req.params.id
    const { name, assignments } = req.body as { name?: string; assignments?: Record<string, unknown> }
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Missing name' })
    const err = validateAssignments(assignments)
    if (err) return res.status(400).json({ error: err })
    const team: Team = { id, name, assignments: (assignments as Team['assignments']) ?? {} }
    setTeam(id, team)
    res.json(team)
  })

  router.delete('/:id', (req, res) => {
    setTeam(req.params.id, null)
    res.json({ success: true })
  })

  // --- Workflow -> Team binding ---

  router.get('/bindings/:workflowId', (req, res) => {
    res.json({ teamId: getWorkflowTeam(req.params.workflowId) ?? null })
  })

  router.put('/bindings/:workflowId', (req, res) => {
    const { teamId } = req.body as { teamId?: string }
    if (!teamId || typeof teamId !== 'string') return res.status(400).json({ error: 'Missing teamId' })
    if (!getTeam(teamId)) return res.status(404).json({ error: 'Team not found' })
    setWorkflowTeam(req.params.workflowId, teamId)
    res.json({ success: true })
  })

  router.delete('/bindings/:workflowId', (req, res) => {
    setWorkflowTeam(req.params.workflowId, null)
    res.json({ success: true })
  })

  return router
}
