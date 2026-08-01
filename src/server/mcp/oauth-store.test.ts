import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  setMcpOAuthStorePath,
  readMcpOAuthEntry,
  saveMcpOAuthClientInformation,
  saveMcpOAuthTokens,
  saveMcpOAuthCodeVerifier,
  saveMcpOAuthState,
  findMcpOAuthEntryByState,
  clearMcpOAuthAuthorizationState,
  clearMcpOAuthTokens,
} from './oauth-store.js'

const SERVER_URL = 'https://mcp.example.com/mcp'

describe('oauth-store', () => {
  let tmpDir: string
  let storePath: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'openfox-oauth-store-'))
    storePath = join(tmpDir, 'mcp-auth.json')
    setMcpOAuthStorePath(storePath)
  })

  afterEach(async () => {
    setMcpOAuthStorePath(undefined)
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('round-trips saved client information and tokens through readMcpOAuthEntry', async () => {
    await saveMcpOAuthClientInformation('srv', SERVER_URL, { client_id: 'client-abc' })
    await saveMcpOAuthTokens('srv', SERVER_URL, { access_token: 'tok-123', token_type: 'Bearer' })

    const entry = await readMcpOAuthEntry('srv', SERVER_URL)
    expect(entry?.serverUrl).toBe(SERVER_URL)
    expect(entry?.clientInformation).toEqual({ client_id: 'client-abc' })
    expect(entry?.tokens).toEqual({ access_token: 'tok-123', token_type: 'Bearer' })
  })

  it.skipIf(process.platform === 'win32')(
    'always leaves the store file at 0600, even if it pre-existed with looser permissions',
    async () => {
      // writeFile's mode option only applies when it creates the file, so pre-creating it at 0644
      // is what would expose the gap if the store didn't chmod explicitly after every write.
      await writeFile(storePath, '{}', { mode: 0o644 })
      await chmod(storePath, 0o644)

      await saveMcpOAuthClientInformation('srv', SERVER_URL, { client_id: 'client-abc' })

      const mode = (await stat(storePath)).mode & 0o777
      expect(mode).toBe(0o600)
    },
  )

  it('saveMcpOAuthTokens clears the pending codeVerifier and state but keeps clientInformation', async () => {
    await saveMcpOAuthClientInformation('srv', SERVER_URL, { client_id: 'client-abc' })
    await saveMcpOAuthCodeVerifier('srv', SERVER_URL, 'verifier-xyz')
    await saveMcpOAuthState('srv', SERVER_URL, 'state-xyz')

    await saveMcpOAuthTokens('srv', SERVER_URL, { access_token: 'tok-123', token_type: 'Bearer' })

    const entry = await readMcpOAuthEntry('srv', SERVER_URL)
    expect(entry?.codeVerifier).toBeUndefined()
    expect(entry?.state).toBeUndefined()
    expect(entry?.clientInformation).toEqual({ client_id: 'client-abc' })
    expect(entry?.tokens).toEqual({ access_token: 'tok-123', token_type: 'Bearer' })
  })

  it('does not return credentials saved for a different server URL', async () => {
    await saveMcpOAuthTokens('srv', SERVER_URL, { access_token: 'tok-123', token_type: 'Bearer' })

    const entry = await readMcpOAuthEntry('srv', 'https://other.example.com/mcp')
    expect(entry).toBeUndefined()
  })

  describe('findMcpOAuthEntryByState', () => {
    it('finds the entry a pending state belongs to, and returns null for an unknown state', async () => {
      await saveMcpOAuthState('srv', SERVER_URL, 'state-xyz')

      const found = await findMcpOAuthEntryByState('state-xyz')
      expect(found?.name).toBe('srv')
      expect(found?.entry.serverUrl).toBe(SERVER_URL)

      expect(await findMcpOAuthEntryByState('unknown-state')).toBeNull()
    })

    it('returns null once the state has been consumed by saving tokens (single use)', async () => {
      await saveMcpOAuthState('srv', SERVER_URL, 'state-xyz')
      await saveMcpOAuthTokens('srv', SERVER_URL, { access_token: 'tok-123', token_type: 'Bearer' })

      expect(await findMcpOAuthEntryByState('state-xyz')).toBeNull()
    })
  })

  it('clearMcpOAuthAuthorizationState burns the state and verifier but keeps working tokens', async () => {
    await saveMcpOAuthClientInformation('srv', SERVER_URL, { client_id: 'client-abc' })
    await saveMcpOAuthTokens('srv', SERVER_URL, { access_token: 'tok-123', token_type: 'Bearer' })
    await saveMcpOAuthCodeVerifier('srv', SERVER_URL, 'verifier-xyz')
    await saveMcpOAuthState('srv', SERVER_URL, 'state-xyz')

    await clearMcpOAuthAuthorizationState('srv', SERVER_URL)

    const entry = await readMcpOAuthEntry('srv', SERVER_URL)
    expect(entry?.state).toBeUndefined()
    expect(entry?.codeVerifier).toBeUndefined()
    expect(entry?.tokens).toEqual({ access_token: 'tok-123', token_type: 'Bearer' })
    expect(entry?.clientInformation).toEqual({ client_id: 'client-abc' })
  })

  it('clearMcpOAuthTokens drops the tokens but keeps the registered client', async () => {
    await saveMcpOAuthClientInformation('srv', SERVER_URL, { client_id: 'client-abc' })
    await saveMcpOAuthTokens('srv', SERVER_URL, { access_token: 'tok-123', token_type: 'Bearer' })

    await clearMcpOAuthTokens('srv', SERVER_URL)

    const entry = await readMcpOAuthEntry('srv', SERVER_URL)
    expect(entry?.tokens).toBeUndefined()
    expect(entry?.clientInformation).toEqual({ client_id: 'client-abc' })
  })

  it('keeps every entry when several authorizations write at the same time', async () => {
    // Each write is a read, modify and write of the whole file, so without serialization the last
    // writer would win with a snapshot taken before its neighbours had committed.
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

    await Promise.all(names.map((name) => saveMcpOAuthState(name, SERVER_URL, `state-${name}`)))

    for (const name of names) {
      expect((await readMcpOAuthEntry(name, SERVER_URL))?.state).toBe(`state-${name}`)
    }
  })

  it('leaves no temporary file behind once a write has landed', async () => {
    await saveMcpOAuthState('srv', SERVER_URL, 'state-xyz')

    expect(await readdir(tmpDir)).toEqual(['mcp-auth.json'])
  })

  describe('a corrupted store on disk', () => {
    it('reads as undefined/null instead of throwing when the file holds invalid JSON', async () => {
      await writeFile(storePath, 'not valid json{{{', 'utf-8')

      expect(await readMcpOAuthEntry('srv', SERVER_URL)).toBeUndefined()
      expect(await findMcpOAuthEntryByState('state-xyz')).toBeNull()
    })

    it('reads as undefined/null instead of throwing when the store path cannot be read as a file', async () => {
      // A directory at the store path fails the read the same way a permissions error would,
      // without depending on the test runner's uid (root bypasses chmod-based restrictions).
      await mkdir(storePath)

      expect(await readMcpOAuthEntry('srv', SERVER_URL)).toBeUndefined()
      expect(await findMcpOAuthEntryByState('state-xyz')).toBeNull()
    })

    it('ignores malformed entries instead of throwing, and still reads the sound ones', async () => {
      // Valid JSON, but entries that no code path of ours could have written. Scanning by state
      // walks every entry, so a single bad one used to take the whole callback route down.
      const sound = { serverUrl: SERVER_URL, state: 'state-xyz' }
      await writeFile(
        storePath,
        JSON.stringify({ version: 1, servers: { broken: null, alsoBroken: 'nope', srv: sound } }),
        'utf-8',
      )

      expect(await readMcpOAuthEntry('broken', SERVER_URL)).toBeUndefined()
      expect(await readMcpOAuthEntry('srv', SERVER_URL)).toEqual(sound)
      expect(await findMcpOAuthEntryByState('state-xyz')).toEqual({ name: 'srv', entry: sound })
    })

    it('leaves the dropped entries out of the file as soon as anything else is written', async () => {
      // Reading filters, and the next write persists that filtered view. Worth pinning down, because
      // it means one bad entry disappears for good the first time an unrelated server is touched.
      await writeFile(
        storePath,
        JSON.stringify({ version: 1, servers: { broken: null, srv: { serverUrl: SERVER_URL } } }),
        'utf-8',
      )

      await saveMcpOAuthState('srv', SERVER_URL, 'state-xyz')

      const onDisk = JSON.parse(await readFile(storePath, 'utf-8')) as { servers: Record<string, unknown> }
      expect(Object.keys(onDisk.servers)).toEqual(['srv'])
    })
  })
})
