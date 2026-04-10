import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import { getRuntimeConfig } from './runtime-config.js'
import type { Mode } from '../cli/main.js'

function getAuthConfigPath(): string {
  const configDir = getRuntimeConfig()
  const mode: Mode = configDir.mode === 'development' ? 'development' : configDir.mode === 'test' ? 'test' : 'production'

  if (mode === 'test') {
    const cwd = process.cwd()
    const base = cwd.endsWith('/e2e') ? cwd : join(cwd, 'e2e')
    return join(base, '.openfox-test', 'auth.json')
  }

  const home = process.env['HOME'] || process.env['USERPROFILE'] || ''
  const basePath = process.env['XDG_CONFIG_HOME'] || `${home}/.config`

  const suffix = mode === 'development' ? '-dev' : ''

  return `${basePath}/openfox${suffix}/auth.json`
}

export interface AuthConfig {
  strategy: 'local' | 'network'
  passwordHash: string | null
}

let cachedAuth: AuthConfig | null = null

export async function loadServerAuthConfig(): Promise<AuthConfig | null> {
  if (cachedAuth) {
    return cachedAuth
  }

  try {
    const authPath = getAuthConfigPath()
    const data = await readFile(authPath, 'utf-8')
    cachedAuth = JSON.parse(data)
    return cachedAuth
  } catch {
    return null
  }
}

export function getAuthConfig(): AuthConfig | null {
  return cachedAuth
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

export function verifyPassword(password: string, hash: string): boolean {
  const passwordHash = hashPassword(password)
  const a = Buffer.from(passwordHash)
  const b = Buffer.from(hash)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function requiresAuth(): boolean {
  return cachedAuth?.strategy === 'network'
}

export function hasPassword(): boolean {
  return cachedAuth?.passwordHash != null && cachedAuth.passwordHash.length > 0
}

export function tokenFromPassword(password: string): string {
  return hashPassword(password)
}

export function isValidToken(token: string): boolean {
  if (!cachedAuth?.passwordHash) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(cachedAuth.passwordHash))
}