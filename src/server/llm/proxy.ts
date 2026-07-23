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
    _cachedAgent = new ProxyAgent({ uri: proxyUrl, requestTls: { rejectUnauthorized: false } })
    logger.info('[proxy] Proxy agent created')
  }
  return _cachedAgent
}

const _originalFetch = globalThis.fetch

// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.fetch = function (input: any, init?: any): Promise<Response> {
  const agent = getProxyAgent()
  if (agent) {
    return undiciFetch(input, { ...init, dispatcher: agent }) as unknown as Promise<Response>
  }
  return _originalFetch(input, init)
}

export function __resetProxyCache(): void {
  if (_cachedAgent) {
    _cachedAgent.destroy().catch(() => {})
  }
  _cachedAgent = undefined
  _cachedProxyUrl = undefined
}
