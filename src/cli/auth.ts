import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import type { Mode } from './main.js'
import { getAuthConfigPath } from './paths.js'

export interface AuthConfig {
  strategy: 'local' | 'network'
  passwordHash: string | null
}

export async function saveAuthConfig(mode: Mode, auth: AuthConfig): Promise<void> {
  const authPath = getAuthConfigPath(mode)
  await mkdir(dirname(authPath), { recursive: true })
  await writeFile(authPath, JSON.stringify(auth, null, 2))
}

export async function loadAuthConfig(mode: Mode): Promise<AuthConfig | null> {
  const authPath = getAuthConfigPath(mode)
  try {
    const data = await readFile(authPath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

export async function authConfigExists(mode: Mode): Promise<boolean> {
  const authPath = getAuthConfigPath(mode)
  try {
    await access(authPath)
    return true
  } catch {
    return false
  }
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash
}