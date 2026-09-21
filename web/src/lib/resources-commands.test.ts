import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from './api'
import { clearCache, snapshot } from './resourceCache'
import { commandDefaultResource, commandResource, commandsResource, readCommands } from './resources'

vi.mock('./api', () => ({
  authFetch: vi.fn(),
}))

function jsonResponse(data: unknown): Response {
  return { ok: true, json: () => Promise.resolve(data) } as unknown as Response
}

describe('commandsResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('scopes the cache key by workdir so wrong-scope data is impossible', () => {
    expect(commandsResource.keyOf('/repo/a')).toBe('commands:/repo/a')
    expect(commandsResource.keyOf('/repo/b')).toBe('commands:/repo/b')
    expect(commandsResource.keyOf(undefined)).toBe('commands:')
    expect(commandsResource.keyOf('/repo/a')).not.toBe(commandsResource.keyOf(undefined))
  })

  it('fetches the commands list scoped to the requested workdir', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ defaults: [] }))
    await commandsResource.refresh('/repo/a')
    expect(authFetch).toHaveBeenCalledWith('/api/commands?workdir=%2Frepo%2Fa')
  })

  it('keeps different workdir scopes isolated in the cache', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      const workdir = url.includes('?workdir=') ? decodeURIComponent(url.split('=')[1] ?? '') : ''
      return jsonResponse({ defaults: [{ id: `cmd-${workdir}` }] })
    })
    await commandsResource.refresh('/repo/a')
    await commandsResource.refresh('/repo/b')

    expect(readCommands('/repo/a')?.defaults[0]?.id).toBe('cmd-/repo/a')
    expect(readCommands('/repo/b')?.defaults[0]?.id).toBe('cmd-/repo/b')
    expect(readCommands('/repo/c')).toBeUndefined()
  })

  it('normalizes missing response fields to empty collections', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({}))
    await commandsResource.refresh(undefined)
    expect(readCommands(undefined)).toEqual({ defaults: [], userItems: [], projectItems: [] })
  })

  it('single-entity command resource keys are scoped by id and workdir', () => {
    expect(commandResource.keyOf('review', '/a')).toBe('command:review:/a')
    expect(commandResource.keyOf('review', '/b')).toBe('command:review:/b')
    expect(commandResource.keyOf('review')).toBe('command:review:')
    expect(commandResource.keyOf('other', '/a')).not.toBe(commandResource.keyOf('review', '/a'))
  })

  it('single-entity command fetch hits the id-scoped URL with workdir', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ metadata: { id: 'review', name: 'Review' }, prompt: 'x' }))
    const full = await commandResource.refresh('review', '/repo/a')
    expect(authFetch).toHaveBeenCalledWith('/api/commands/review?workdir=%2Frepo%2Fa')
    expect(full?.metadata.id).toBe('review')
  })

  it('invalidate-on-edit drops the single-entity cache entry for the edited command', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ metadata: { id: 'review', name: 'Review' }, prompt: 'x' }))
    await commandResource.refresh('review', '/repo/a')
    expect(snapshot(commandResource.keyOf('review', '/repo/a')).data).not.toBeNull()

    commandResource.invalidate('review', '/repo/a')
    expect(snapshot(commandResource.keyOf('review', '/repo/a')).data).toBeUndefined()
    // The sibling scope is untouched by invalidate-on-edit.
    expect(snapshot(commandResource.keyOf('review', '/repo/b')).data).toBeUndefined()
  })

  it('command default resource is keyed by id only and hits the defaults URL', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ metadata: { id: 'summarize', name: 'S' }, prompt: 'p' }))
    const full = await commandDefaultResource.refresh('summarize')
    expect(authFetch).toHaveBeenCalledWith('/api/commands/defaults/summarize')
    expect(full?.metadata.id).toBe('summarize')
    expect(commandDefaultResource.keyOf('summarize')).toBe('command-default:summarize')
  })

  it('missing single-entity command resolves to null without throwing', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: false, json: () => Promise.resolve({}) } as unknown as Response)
    const full = await commandResource.refresh('ghost', '/repo/a')
    expect(full).toBeNull()
  })
})
