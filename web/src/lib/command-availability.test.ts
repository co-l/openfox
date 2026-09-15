import { describe, expect, it } from 'vitest'
import { resolveCommandAvailability } from './command-availability'
import type { CommandInfo } from './commands-actions'

const scopes = (over: Partial<Record<'defaults' | 'userItems' | 'projectItems', CommandInfo[]>> = {}) => ({
  defaults: [{ id: 'end-of-session', name: 'End of Session' }],
  userItems: [],
  projectItems: [],
  ...over,
})

describe('resolveCommandAvailability', () => {
  it('reads an empty setting as disabled', () => {
    expect(resolveCommandAvailability(scopes(), '')).toEqual({ state: 'disabled' })
    expect(resolveCommandAvailability(scopes(), '   ')).toEqual({ state: 'disabled' })
  })

  it('says nothing while the command list has not arrived', () => {
    expect(resolveCommandAvailability(undefined, 'end-of-session')).toEqual({ state: 'loading' })
  })

  it('accepts the slash-prefixed form the composer uses', () => {
    expect(resolveCommandAvailability(scopes(), '/end-of-session')).toEqual({
      state: 'available',
      commandId: 'end-of-session',
    })
  })

  it('reports an unknown id as not_found', () => {
    expect(resolveCommandAvailability(scopes(), 'ghost')).toEqual({ state: 'not_found', commandId: 'ghost' })
  })

  it('reports a command that demands parameters', () => {
    const result = resolveCommandAvailability(
      scopes({ userItems: [{ id: 'mem', name: 'Mem', paramNames: ['text'] }] }),
      'mem',
    )
    expect(result).toEqual({ state: 'needs_params', commandId: 'mem', paramNames: ['text'] })
  })

  it('judges the winning definition, not the first list that has the id', () => {
    const shadowedByProject = scopes({
      defaults: [{ id: 'wrap', name: 'Wrap', paramNames: ['x'] }],
      projectItems: [{ id: 'wrap', name: 'Wrap (project)' }],
    })
    expect(resolveCommandAvailability(shadowedByProject, 'wrap')).toEqual({ state: 'available', commandId: 'wrap' })

    const shadowedByUser = scopes({
      defaults: [{ id: 'wrap', name: 'Wrap' }],
      userItems: [{ id: 'wrap', name: 'Wrap', paramNames: ['x'] }],
    })
    expect(resolveCommandAvailability(shadowedByUser, 'wrap')).toEqual({
      state: 'needs_params',
      commandId: 'wrap',
      paramNames: ['x'],
    })
  })
})
