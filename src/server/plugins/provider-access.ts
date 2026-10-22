import type { Provider } from '../../shared/types.js'
import type { PluginProviderAccess, PluginProviderInfo } from '../../plugin/index.js'
import type { ProviderAuthAdapter } from '../../provider/index.js'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 60_000
const MAX_RESPONSE_BYTES = 1_000_000

/**
 * Explicit, verified endpoint mappings keyed by trusted service origin.
 * Credentials are only ever attached to an endpoint whose origin matches one
 * of these entries (or a loopback origin for the local System One route).
 * Nothing is ever derived by blindly appending a path to a provider URL.
 */
const VERIFIED_ENDPOINTS: Record<string, Record<string, string>> = {
  'https://openrouter.ai': {
    decisions: 'https://openrouter.ai/api/alpha/decisions',
  },
  'https://api.deepinfra.com': {
    decisions: 'https://api.deepinfra.com/v1/decisions',
  },
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export interface PluginProviderAccessDeps {
  getProviders(): Provider[]
  getAuth?(adapterId: string): ProviderAuthAdapter | undefined
}

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

function toInfo(provider: Provider): PluginProviderInfo {
  return {
    id: provider.id,
    name: provider.name,
    backend: provider.backend,
    url: provider.url,
    isActive: provider.isActive,
    ...(provider.status ? { status: provider.status } : {}),
    ...(provider.isLocal !== undefined ? { isLocal: provider.isLocal } : {}),
    hasCredential: Boolean(provider.apiKey || provider.credentialRef),
    ...(provider.authAdapter ? { authAdapter: provider.authAdapter } : {}),
    models: provider.models.map((model) => model.id),
  }
}

/**
 * Resolve the request URL for a provider + endpoint key.
 * Throws when the provider origin has no verified mapping — credentials are
 * never sent to an origin that was not explicitly authorized.
 */
export function resolveEndpoint(providerUrl: string, endpointKey: string): string {
  let parsed: URL
  try {
    parsed = new URL(providerUrl)
  } catch {
    throw new Error('Provider URL is not a valid URL')
  }
  const origin = parsed.origin

  const mapped = VERIFIED_ENDPOINTS[origin]?.[endpointKey]
  if (mapped) return mapped

  if (isLoopback(parsed.hostname)) {
    // Local servers (Jev-Style): HTTP is permitted on loopback only.
    if (endpointKey === 'systemone') return `${origin}/v1/systemone`
    if (endpointKey === 'health') return `${origin}/healthz`
    throw new Error(`Unknown endpoint '${endpointKey}' for local provider`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Remote provider endpoints must use HTTPS')
  }
  throw new Error(`No verified endpoint mapping for provider origin ${origin}`)
}

/**
 * Compose the strict request timeout with an optional cancellation signal.
 * The caller's abort wins immediately (fail closed); the timeout still
 * bounds requests that carry no signal.
 */
function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, signal]) : signal
}

async function resolveAuthHeaders(provider: Provider, deps: PluginProviderAccessDeps): Promise<Record<string, string>> {
  if (provider.credentialRef && provider.authAdapter) {
    const adapter = deps.getAuth?.(provider.authAdapter)
    if (!adapter) throw new Error('Provider auth adapter is unavailable')
    const access = await adapter.getAccessContext(provider.credentialRef)
    if (access.headers && Object.keys(access.headers).length > 0) return { ...access.headers }
    if (access.accessToken) return { Authorization: `Bearer ${access.accessToken}` }
    throw new Error('Provider credentials are missing or expired')
  }
  if (provider.apiKey) return { Authorization: `Bearer ${provider.apiKey}` }
  throw new Error('Provider has no configured credentials')
}

/**
 * Narrow, credential-safe provider access for plugins.
 *
 * - Lists non-sensitive provider metadata only.
 * - Performs authenticated JSON POSTs server-side against verified endpoints.
 * - Never returns credentials, never follows redirects (no cross-origin
 *   credential forwarding), enforces HTTPS for remote origins, loopback-only
 *   HTTP, a strict timeout and a response size cap.
 * - Error messages never contain credential material.
 */
export function createPluginProviderAccess(deps: PluginProviderAccessDeps): PluginProviderAccess {
  const findProvider = (providerId: string): Provider => {
    const provider = deps.getProviders().find((candidate) => candidate.id === providerId)
    if (!provider) throw new Error('Provider not found')
    // `isActive` marks the provider currently selected for chat. A plugin that
    // explicitly selects a provider (its own setting = operator consent) must
    // be able to use it even when the session chats on a different model.
    return provider
  }

  return {
    listProviders(): PluginProviderInfo[] {
      return deps.getProviders().map(toInfo)
    },

    getProvider(providerId: string): PluginProviderInfo | undefined {
      const provider = deps.getProviders().find((candidate) => candidate.id === providerId)
      return provider ? toInfo(provider) : undefined
    },

    async requestJson(
      providerId: string,
      endpointKey: string,
      body: unknown,
      options?: { timeoutMs?: number; signal?: AbortSignal },
    ): Promise<unknown> {
      const provider = findProvider(providerId)
      const url = resolveEndpoint(provider.url, endpointKey)
      // Local loopback servers (Jev-Style) need no credentials by default;
      // an apiKey, when configured, is still sent as a bearer token.
      const headers = isLoopback(new URL(url).hostname)
        ? provider.apiKey
          ? { Authorization: `Bearer ${provider.apiKey}` }
          : {}
        : await resolveAuthHeaders(provider, deps)
      const timeoutMs = Math.min(Math.max(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS)

      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: requestSignal(timeoutMs, options?.signal),
      })

      if (!response.ok) {
        // Status only — response bodies can echo request data.
        throw new Error(`Provider request failed with status ${response.status}`)
      }

      const text = await response.text()
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('Provider response exceeded size limit')
      try {
        return JSON.parse(text) as unknown
      } catch {
        throw new Error('Provider returned an invalid JSON response')
      }
    },
  }
}
