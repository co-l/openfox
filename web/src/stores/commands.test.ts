// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '../lib/api'
import { useCommandsStore, type CommandInfo } from './commands'

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

const mockedAuthFetch = vi.mocked(authFetch)

function command(id: string): CommandInfo {
  return { id, name: id }
}

describe('commands store deletion', () => {
  beforeEach(() => {
    mockedAuthFetch.mockReset()
    useCommandsStore.setState({
      defaults: [],
      userItems: [command('user-command')],
      projectItems: [command('project-command')],
      loading: false,
    })
  })

  it('removes a deleted project command from client state', async () => {
    mockedAuthFetch.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await useCommandsStore.getState().deleteCommand('project-command')

    expect(result).toEqual({ success: true })
    expect(useCommandsStore.getState().userItems).toEqual([command('user-command')])
    expect(useCommandsStore.getState().projectItems).toEqual([])
  })
})
