// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '../lib/api'
import { useCommandsStore, type CommandFull, type CommandInfo } from './commands'

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

const mockedAuthFetch = vi.mocked(authFetch)

function command(id: string): CommandInfo {
  return { id, name: id }
}

const commandFull: CommandFull = {
  metadata: { id: 'custom-review', name: 'Review' },
  prompt: 'Review the proposed changes.',
}

function jsonResponse(data: unknown = {}): Response {
  return {
    ok: true,
    json: () => Promise.resolve(data),
  } as Response
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

describe('CommandsStore project scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCommandsStore.setState({
      defaults: [],
      userItems: [],
      projectItems: [],
      loading: false,
    })
    mockedAuthFetch.mockResolvedValue(jsonResponse())
  })

  it('sends the project workdir when creating a command and refreshing the list', async () => {
    await useCommandsStore.getState().createCommand(commandFull, 'project', '/projects/client app')

    expect(mockedAuthFetch).toHaveBeenNthCalledWith(
      1,
      '/api/commands?workdir=%2Fprojects%2Fclient%20app',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/commands?workdir=%2Fprojects%2Fclient%20app')
  })

  it('sends the project workdir when updating a command and refreshing the list', async () => {
    await useCommandsStore.getState().updateCommand(commandFull.metadata.id, commandFull, 'C:\\projects\\client')

    expect(mockedAuthFetch).toHaveBeenNthCalledWith(
      1,
      '/api/commands/custom-review?workdir=C%3A%5Cprojects%5Cclient',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/commands?workdir=C%3A%5Cprojects%5Cclient')
  })

  it('keeps global requests unchanged when no project workdir is available', async () => {
    await useCommandsStore.getState().createCommand(commandFull, 'user')

    expect(mockedAuthFetch).toHaveBeenNthCalledWith(1, '/api/commands', expect.objectContaining({ method: 'POST' }))
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/commands')
  })
})
