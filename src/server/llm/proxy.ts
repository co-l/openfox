import { logger } from '../utils/logger.js'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'
import { fetch as undiciFetch, ProxyAgent } from 'undici'

let _cachedProxyUrl: string | undefined
let _cachedAgent: ProxyAgent | undefined

function getProxyAgent(): ProxyAgent | undefined {
  const proxyUrl = getSetting(SETTINGS_KEYS.PROXY_URL) ?? undefined
  if (!proxyUrl) return undefined
  if (proxyUrl !== _cachedProxyUrl) {
    _cachedProxyUrl = proxyUrl
    _cachedAgent = new ProxyAgent({
      uri: proxyUrl,
      requestTls: { rejectUnauthorized: false },
    })
    logger.info('[proxy] Proxy agent created', { proxyUrl })
  }
  return _cachedAgent
}

export async function proxyFetch(url: string | URL, options?: Parameters<typeof fetch>[1]): Promise<Response> {
  const agent = getProxyAgent()
  if (agent) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return undiciFetch(url as any, { ...(options as any), dispatcher: agent }) as unknown as Response
  }
  return fetch(url, options)
}
