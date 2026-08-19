/**
 * Teams
 *
 * A team is a named bundle of per-step model assignments (`stepId -> override`)
 * that can be bound to a workflow. Binding a workflow to a team makes every
 * run of that workflow resolve each step's model from the team, transparently,
 * without writing individual step overrides.
 *
 * Resolution precedence (in resolveLLMClientForStep):
 *   explicit step override > team assignment > agent override > session.
 *
 * Stored in DB settings:
 *   `teams`        -> { [teamId]: Team }
 *   `workflow.team` -> { [workflowId]: teamId }
 */

import { z } from 'zod'
import { getSetting, setSetting, SETTINGS_KEYS } from '../db/settings.js'
import { overrideSchema, type AgentModelOverride } from './override-schema.js'
import { parseJsonObject } from './settings-json.js'

export const TEAMS_KEY = SETTINGS_KEYS.TEAMS
export const WORKFLOW_TEAM_KEY = SETTINGS_KEYS.WORKFLOW_TEAM

/** A per-step assignment within a team: same shape as an agent/step override. */
export type TeamAssignment = AgentModelOverride

const teamSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  assignments: z.record(z.string(), overrideSchema),
})

export type Team = z.infer<typeof teamSchema>
export type Teams = Record<string, Team>

export function parseTeams(raw: string | null | undefined): Teams {
  const parsed = parseJsonObject(raw)
  if (!parsed) return {}

  const result: Teams = {}
  for (const [id, value] of Object.entries(parsed)) {
    const validated = teamSchema.safeParse(value)
    if (validated.success) {
      result[id] = validated.data
    }
  }
  return result
}

export function getTeams(): Teams {
  return parseTeams(getSetting(TEAMS_KEY))
}

export function getTeam(teamId: string): Team | undefined {
  return getTeams()[teamId]
}

export function setTeam(teamId: string, team: Team | null): void {
  const teams = getTeams()
  if (team === null) {
    delete teams[teamId]
  } else {
    teams[teamId] = team
  }
  setSetting(TEAMS_KEY, JSON.stringify(teams))
}

// ----------------------------------------------------------------------------
// Workflow -> Team binding
// ----------------------------------------------------------------------------

function parseWorkflowTeamMap(raw: string | null | undefined): Record<string, string> {
  const parsed = parseJsonObject(raw)
  if (!parsed) return {}

  const result: Record<string, string> = {}
  for (const [workflowId, teamId] of Object.entries(parsed)) {
    if (typeof teamId === 'string' && teamId.length > 0) {
      result[workflowId] = teamId
    }
  }
  return result
}

export function getWorkflowTeam(workflowId: string): string | undefined {
  return parseWorkflowTeamMap(getSetting(WORKFLOW_TEAM_KEY))[workflowId]
}

export function setWorkflowTeam(workflowId: string, teamId: string | null): void {
  const map = parseWorkflowTeamMap(getSetting(WORKFLOW_TEAM_KEY))
  if (teamId === null) {
    delete map[workflowId]
  } else {
    map[workflowId] = teamId
  }
  setSetting(WORKFLOW_TEAM_KEY, JSON.stringify(map))
}
