import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export interface UrlValidationResult {
  valid: boolean
  error?: string
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false

  const [a, b] = parts

  // 0.0.0.0/8 — "this network"
  if (a === 0) return true
  // 10.0.0.0/8 — private
  if (a === 10) return true
  // 127.0.0.0/8 — loopback
  if (a === 127) return true
  // 169.254.0.0/16 — link-local (cloud metadata)
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12 — private
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true
  // 192.0.0.0/24, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24 — reserved
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51) return true
  if (a === 203 && b === 0) return true
  // 224.0.0.0/4 — multicast, 240.0.0.0/4 — reserved
  if (a !== undefined && a >= 224) return true

  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  // ::1 — loopback
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true
  // :: — unspecified
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true
  // fc00::/7 — unique local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  // fe80::/10 — link-local
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true
  }
  // 64:ff9b::/96 — NAT64 well-known prefix mapping to IPv4
  if (lower.startsWith('64:ff9b:')) return true

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 or canonical form ::ffff:7f00:1
  const v4MappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (v4MappedDotted?.[1]) return isPrivateIPv4(v4MappedDotted[1])

  const v4MappedHex = lower.match(/^(?:0:0:0:0:0:ffff:|::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (v4MappedHex?.[1] && v4MappedHex?.[2]) {
    const high = parseInt(v4MappedHex[1], 16)
    const low = parseInt(v4MappedHex[2], 16)
    const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
    return isPrivateIPv4(ipv4)
  }

  return false
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, '')
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true
  if (lower === 'ip6-localhost' || lower === 'ip6-loopback') return true
  if (lower.endsWith('.internal')) return true
  if (lower.endsWith('.local')) return true
  if (lower.endsWith('.lan')) return true
  if (lower.endsWith('.home')) return true
  if (lower.endsWith('.corp')) return true
  return false
}

function parseHttpUrl(urlString: string): { hostname: string } | { error: string } {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    return { error: 'Invalid URL' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'URL must use http:// or https:// protocol' }
  }

  const hostname = parsed.hostname
  if (!hostname) {
    return { error: 'URL must have a hostname' }
  }

  return { hostname }
}

function checkLiteralIp(hostname: string): { blocked: boolean; reason?: string } {
  const bareHost = hostname.replace(/^\[|\]$/g, '')
  if (!isIP(bareHost)) {
    return { blocked: false }
  }
  if (isIP(bareHost) === 4 && isPrivateIPv4(bareHost)) {
    return { blocked: true, reason: `Blocked: ${bareHost} is a private/reserved IPv4 address` }
  }
  if (isIP(bareHost) === 6 && isPrivateIPv6(bareHost)) {
    return { blocked: true, reason: `Blocked: ${bareHost} is a private/reserved IPv6 address` }
  }
  return { blocked: false }
}

async function resolveAndCheckIp(hostname: string): Promise<{ blocked: boolean; reason?: string }> {
  const literalCheck = checkLiteralIp(hostname)
  if (literalCheck.blocked || isIP(hostname.replace(/^\[|\]$/g, ''))) {
    return literalCheck
  }

  if (isBlockedHostname(hostname)) {
    return { blocked: true, reason: `Blocked: ${hostname} is a local/internal hostname` }
  }

  try {
    const addresses = await lookup(hostname, { all: true })
    for (const addr of addresses) {
      if (addr.family === 4 && isPrivateIPv4(addr.address)) {
        return { blocked: true, reason: `Blocked: ${hostname} resolves to private IP ${addr.address}` }
      }
      if (addr.family === 6 && isPrivateIPv6(addr.address)) {
        return { blocked: true, reason: `Blocked: ${hostname} resolves to private IPv6 ${addr.address}` }
      }
    }
    return { blocked: false }
  } catch {
    return { blocked: true, reason: `Blocked: could not resolve hostname ${hostname}` }
  }
}

export async function validatePublicUrl(urlString: string): Promise<UrlValidationResult> {
  const parsed = parseHttpUrl(urlString)
  if ('error' in parsed) {
    return { valid: false, error: parsed.error }
  }

  const check = await resolveAndCheckIp(parsed.hostname)
  if (check.blocked) {
    return { valid: false, error: check.reason ?? 'Blocked URL' }
  }

  return { valid: true }
}

export function validatePublicUrlSync(urlString: string): UrlValidationResult {
  const parsed = parseHttpUrl(urlString)
  if ('error' in parsed) {
    return { valid: false, error: parsed.error }
  }

  const literalCheck = checkLiteralIp(parsed.hostname)
  if (literalCheck.blocked) {
    return { valid: false, error: literalCheck.reason ?? 'Blocked URL' }
  }
  if (isIP(parsed.hostname.replace(/^\[|\]$/g, ''))) {
    return { valid: true }
  }

  if (isBlockedHostname(parsed.hostname)) {
    return { valid: false, error: `Blocked: ${parsed.hostname} is a local/internal hostname` }
  }

  return { valid: true }
}
