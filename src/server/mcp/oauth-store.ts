import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Mode } from '../../cli/main.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { logger } from '../utils/logger.js'

/**
 * OAuth credentials for one MCP server. Deliberately kept out of config.json: that file is meant to
 * be readable, diffable and shareable, while these are bearer credentials.
 *
 * The store file is written with 0600. That is a real guarantee on POSIX only, Windows has no
 * equivalent mapping for those bits.
 */
export interface McpOAuthEntry {
  /** The server URL the credentials were issued for. Credentials do not carry over to another URL. */
  serverUrl: string
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  /** PKCE verifier, only alive between the authorization request and the token exchange. */
  codeVerifier?: string
  /** CSRF state, only alive between the authorization request and the token exchange. */
  state?: string
}

interface McpOAuthStore {
  version: 1
  servers: Record<string, McpOAuthEntry>
}

let storeMode: Mode = 'production'
let storePathOverride: string | undefined

export function setMcpOAuthStoreMode(mode: Mode): void {
  storeMode = mode
}

export function setMcpOAuthStorePath(path: string | undefined): void {
  storePathOverride = path
}

export function getMcpOAuthStorePath(): string {
  return storePathOverride ?? join(getGlobalConfigDir(storeMode), 'mcp-auth.json')
}

async function readStore(): Promise<McpOAuthStore> {
  const path = getMcpOAuthStorePath()
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return { version: 1, servers: {} }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<McpOAuthStore>
    const servers = parsed.servers
    if (!servers || typeof servers !== 'object') throw new Error('no servers object')
    // Valid JSON is not a valid store. A hand edited or half written entry must be dropped here,
    // otherwise every reader has to defend itself against a shape that should never have been saved.
    // Said out loud, because the next write persists this filtered view and the entry is then gone.
    const kept: Record<string, McpOAuthEntry> = {}
    for (const [name, entry] of Object.entries(servers)) {
      if (entry && typeof entry === 'object' && typeof (entry as McpOAuthEntry).serverUrl === 'string') {
        kept[name] = entry as McpOAuthEntry
      } else {
        logger.warn('Dropping an unreadable MCP OAuth entry, this server will have to authorize again', {
          path,
          server: name,
        })
      }
    }
    return { version: 1, servers: kept }
  } catch {
    // Worth shouting about: the next write would otherwise quietly replace everything that was there.
    logger.error('The MCP OAuth store is unreadable, stored authorizations will be ignored', { path })
    return { version: 1, servers: {} }
  }
}

async function writeStore(store: McpOAuthStore): Promise<void> {
  const path = getMcpOAuthStorePath()
  await mkdir(dirname(path), { recursive: true })
  // Written aside then renamed, so an interrupted write cannot leave half a file behind. The rename
  // also carries the fresh 0600 over a pre-existing file that had looser bits.
  const tmpPath = `${path}.tmp`
  await writeFile(tmpPath, JSON.stringify(store, null, 2), { mode: 0o600 })
  try {
    await chmod(tmpPath, 0o600)
  } catch {
    logger.warn('Could not restrict permissions on the MCP OAuth store', { path })
  }
  await rename(tmpPath, path)
}

/** Read, modify and write is not atomic, so two authorizations in flight would clobber each other. */
let writeQueue: Promise<unknown> = Promise.resolve()

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(work, work)
  writeQueue = result.catch(() => undefined)
  return result
}

async function mutateEntry(
  name: string,
  serverUrl: string,
  mutate: (entry: McpOAuthEntry) => McpOAuthEntry,
): Promise<void> {
  await serialize(async () => {
    const store = await readStore()
    const current = store.servers[name]
    const base: McpOAuthEntry = current && current.serverUrl === serverUrl ? current : { serverUrl }
    store.servers[name] = mutate(base)
    await writeStore(store)
  })
}

/** Keeps what outlives an authorization round trip, drops the one shot values it used. */
function withoutAuthorizationState(entry: McpOAuthEntry): McpOAuthEntry {
  const next: McpOAuthEntry = { serverUrl: entry.serverUrl }
  if (entry.clientInformation) next.clientInformation = entry.clientInformation
  if (entry.tokens) next.tokens = entry.tokens
  return next
}

export async function readMcpOAuthEntry(name: string, serverUrl: string): Promise<McpOAuthEntry | undefined> {
  const store = await readStore()
  const entry = store.servers[name]
  if (!entry || entry.serverUrl !== serverUrl) return undefined
  return entry
}

export async function saveMcpOAuthClientInformation(
  name: string,
  serverUrl: string,
  clientInformation: OAuthClientInformationMixed,
): Promise<void> {
  await mutateEntry(name, serverUrl, (entry) => ({ ...entry, clientInformation }))
}

export async function saveMcpOAuthTokens(name: string, serverUrl: string, tokens: OAuthTokens): Promise<void> {
  await mutateEntry(name, serverUrl, (entry) => ({ ...withoutAuthorizationState(entry), tokens }))
}

export async function saveMcpOAuthCodeVerifier(name: string, serverUrl: string, codeVerifier: string): Promise<void> {
  await mutateEntry(name, serverUrl, (entry) => ({ ...entry, codeVerifier }))
}

export async function saveMcpOAuthState(name: string, serverUrl: string, state: string): Promise<void> {
  await mutateEntry(name, serverUrl, (entry) => ({ ...entry, state }))
}

/** Forgets the tokens, keeps the registered client so a new authorization need not register again. */
export async function clearMcpOAuthTokens(name: string, serverUrl: string): Promise<void> {
  await mutateEntry(name, serverUrl, (entry) => {
    const next = withoutAuthorizationState(entry)
    delete next.tokens
    return next
  })
}

/** Burns the state and the verifier of an attempt, whether that attempt succeeded or failed. */
export async function clearMcpOAuthAuthorizationState(name: string, serverUrl: string): Promise<void> {
  await mutateEntry(name, serverUrl, withoutAuthorizationState)
}

export async function clearMcpOAuthEntry(name: string): Promise<void> {
  await serialize(async () => {
    const store = await readStore()
    if (!(name in store.servers)) return
    delete store.servers[name]
    await writeStore(store)
  })
}

/** Resolves the pending authorization a callback belongs to. State is single use, saving tokens drops it. */
export async function findMcpOAuthEntryByState(state: string): Promise<{ name: string; entry: McpOAuthEntry } | null> {
  const store = await readStore()
  for (const [name, entry] of Object.entries(store.servers)) {
    if (entry.state && entry.state === state) return { name, entry }
  }
  return null
}
