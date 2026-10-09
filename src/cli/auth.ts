import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname } from 'node:path'
import { constants, publicEncrypt } from 'node:crypto'
import type { Mode } from './main.js'
import { getAuthConfigPath } from './paths.js'
import type { AuthConfig } from '../server/auth.js'

export type { AuthConfig }

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

export function encryptPassword(password: string, publicKey: string): string {
  const encrypted = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(password),
  )
  return encrypted.toString('base64')
}
