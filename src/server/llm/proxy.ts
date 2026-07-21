import { logger } from '../utils/logger.js'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'
import { fetch as undiciFetch, ProxyAgent } from 'undici'

let _cachedProxyUrl: string | undefined
let _cachedAgent: ProxyAgent | undefined

function getProxyAgent(): ProxyAgent | undefined {
  const proxyUrl = getSetting(SETTINGS_KEYS.PROXY_URL) ?? undefined

  if (!proxyUrl) {
    if (_cachedAgent) {
      _cachedAgent.destroy().catch((err: unknown) => {
        logger.warn('[proxy] Failed to destroy old proxy agent', { error: err })
      })
      _cachedAgent = undefined
      _cachedProxyUrl = undefined
    }
    return undefined
  }

  if (proxyUrl !== _cachedProxyUrl) {
    if (_cachedAgent) {
      _cachedAgent.destroy().catch((err: unknown) => {
        logger.warn('[proxy] Failed to destroy old proxy agent', { error: err })
      })
    }
    _cachedProxyUrl = proxyUrl
    try {
      _cachedAgent = new ProxyAgent({
        uri: proxyUrl,
        requestTls: { rejectUnauthorized: true },
      })
      logger.info('[proxy] Proxy agent created', { proxyUrl })
    } catch (err) {
      logger.error('[proxy] Failed to create proxy agent', { proxyUrl, error: err })
      _cachedAgent = undefined
      _cachedProxyUrl = undefined
      return undefined
    }
  }
  return _cachedAgent
}

export async function proxyFetch(url: string | URL, options?: RequestInit): Promise<Response> {
  const agent = getProxyAgent()
  if (agent) {
    return undiciFetch(url, { ...options, dispatcher: agent } as unknown as Parameters<
      typeof undiciFetch
    >[1]) as unknown as Response
  }
  return fetch(url, options)
}

export function __resetProxyCache(): void {
  if (_cachedAgent) {
    _cachedAgent.destroy().catch(() => {})
  }
  _cachedAgent = undefined
  _cachedProxyUrl = undefined
}
