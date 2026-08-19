/**
 * Teams Tests
 *
 * A team is a named map of stepId -> model override, bound to a workflow via
 * `workflow.team` (workflowId -> teamId). Resolution is lazy in
 * resolveLLMClientForStep: step override > team assignment > agent override.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getSettingMock, setSettingMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
  setSettingMock: vi.fn(),
}))

vi.mock('../db/settings.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../db/settings.js')>()
  return {
    ...original,
    getSetting: getSettingMock,
    setSetting: setSettingMock,
  }
})

import {
  parseTeams,
  getTeam,
  setTeam,
  getWorkflowTeam,
  setWorkflowTeam,
  TEAMS_KEY,
  WORKFLOW_TEAM_KEY,
} from './teams.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseTeams', () => {
  it('returns empty map for null/undefined/invalid JSON', () => {
    expect(parseTeams(null)).toEqual({})
    expect(parseTeams(undefined)).toEqual({})
    expect(parseTeams('not json')).toEqual({})
    expect(parseTeams('[]')).toEqual({})
    expect(parseTeams('"str"')).toEqual({})
  })

  it('parses valid teams and drops malformed ones', () => {
    const raw = JSON.stringify({
      'team-a': {
        id: 'team-a',
        name: 'Team A',
        assignments: {
          build: { providerId: 'p1', model: 'm1' },
          verify: { providerId: 'p2', model: 'm2', reasoningEffort: 'high' },
        },
      },
      bad1: { id: 'bad1', name: 'Bad', assignments: 'nope' },
      bad2: { id: 'bad2', assignments: {} },
      bad3: 'nope',
    })
    expect(parseTeams(raw)).toEqual({
      'team-a': {
        id: 'team-a',
        name: 'Team A',
        assignments: {
          build: { providerId: 'p1', model: 'm1' },
          verify: { providerId: 'p2', model: 'm2', reasoningEffort: 'high' },
        },
      },
    })
  })
})

describe('getTeam / setTeam', () => {
  it('returns undefined when no teams stored', () => {
    getSettingMock.mockReturnValue(null)
    expect(getTeam('team-a')).toBeUndefined()
    expect(getSettingMock).toHaveBeenCalledWith(TEAMS_KEY)
  })

  it('returns the team for a known id', () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({
        'team-a': { id: 'team-a', name: 'Team A', assignments: { build: { providerId: 'p1', model: 'm1' } } },
      }),
    )
    expect(getTeam('team-a')?.name).toBe('Team A')
    expect(getTeam('team-b')).toBeUndefined()
  })

  it('writes a new team without clobbering others', () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({
        'team-b': { id: 'team-b', name: 'Team B', assignments: {} },
      }),
    )
    setTeam('team-a', { id: 'team-a', name: 'Team A', assignments: { build: { providerId: 'p1', model: 'm1' } } })
    const [, value] = setSettingMock.mock.calls[0]!
    const parsed = JSON.parse(value as string)
    expect(parsed['team-a'].name).toBe('Team A')
    expect(parsed['team-b'].name).toBe('Team B')
  })

  it('removes a team when passed null', () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({
        'team-a': { id: 'team-a', name: 'Team A', assignments: {} },
        'team-b': { id: 'team-b', name: 'Team B', assignments: {} },
      }),
    )
    setTeam('team-a', null)
    const [, value] = setSettingMock.mock.calls[0]!
    const parsed = JSON.parse(value as string)
    expect(parsed['team-a']).toBeUndefined()
    expect(parsed['team-b']).toBeDefined()
  })
})

describe('getWorkflowTeam / setWorkflowTeam', () => {
  it('returns undefined when no binding stored', () => {
    getSettingMock.mockReturnValue(null)
    expect(getWorkflowTeam('wf')).toBeUndefined()
    expect(getSettingMock).toHaveBeenCalledWith(WORKFLOW_TEAM_KEY)
  })

  it('returns the bound team id for a workflow', () => {
    getSettingMock.mockReturnValue(JSON.stringify({ wf: 'team-a' }))
    expect(getWorkflowTeam('wf')).toBe('team-a')
    expect(getWorkflowTeam('other')).toBeUndefined()
  })

  it('sets a workflow binding, merging with existing bindings', () => {
    getSettingMock.mockReturnValue(JSON.stringify({ other: 'team-b' }))
    setWorkflowTeam('wf', 'team-a')
    expect(setSettingMock).toHaveBeenCalledWith(WORKFLOW_TEAM_KEY, JSON.stringify({ other: 'team-b', wf: 'team-a' }))
  })

  it('removes a workflow binding when passed null', () => {
    getSettingMock.mockReturnValue(JSON.stringify({ wf: 'team-a', other: 'team-b' }))
    setWorkflowTeam('wf', null)
    expect(setSettingMock).toHaveBeenCalledWith(WORKFLOW_TEAM_KEY, JSON.stringify({ other: 'team-b' }))
  })
})
