import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash, createPrivateKey, privateDecrypt, createPublicKey, createSign, constants } from 'node:crypto'
import { getRuntimeConfig } from './runtime-config.js'
import { getGlobalConfigDir } from '../cli/paths.js'
import type { Mode } from '../cli/main.js'

function resolveMode(): Mode {
  const mode = getRuntimeConfig().mode
  return mode === 'development' ? 'development' : mode === 'test' ? 'test' : 'production'
}

function getAuthDir(): string {
  return getRuntimeConfig().authDir ?? getGlobalConfigDir(resolveMode())
}

function getAuthConfigPath(): string {
  return join(getAuthDir(), 'auth.json')
}

function getAuthKeyPath(): string {
  return join(getAuthDir(), 'auth.key')
}

export interface AuthConfig {
  strategy: 'local' | 'network'
  encryptedPassword: string | null
  sessionKey?: string
}

let cachedAuth: AuthConfig | null = null
let cachedPrivateKey: string | null = null

export function resetAuthCache(): void {
  cachedAuth = null
  cachedPrivateKey = null
}

async function loadPrivateKey(): Promise<string> {
  if (cachedPrivateKey) {
    return cachedPrivateKey
  }

  const keyPath = getAuthKeyPath()
  const keyDir = dirname(keyPath)

  try {
    cachedPrivateKey = await readFile(keyPath, 'utf-8')
    return cachedPrivateKey
  } catch {
    const { privateKey } = await import('node:crypto').then((c) =>
      c.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      }),
    )

    await mkdir(keyDir, { recursive: true })
    await writeFile(keyPath, privateKey, { mode: 0o600 })

    cachedPrivateKey = privateKey
    return privateKey
  }
}

export async function loadServerAuthConfig(): Promise<AuthConfig | null> {
  if (cachedAuth) {
    return cachedAuth
  }

  try {
    const data = await readFile(getAuthConfigPath(), 'utf-8')
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

function keyByteLength(privateKey: string): number {
  const bits = createPrivateKey(privateKey).asymmetricKeyDetails?.modulusLength
  if (!bits) throw new Error('unsupported key')
  return Math.ceil(Number(bits) / 8)
}

export function decryptPassword(privateKey: string, encryptedPassword: string): Buffer | null {
  const data = Buffer.from(encryptedPassword, 'base64')
  if (data.length === 0) return null

  let keyBytes: number
  try {
    keyBytes = keyByteLength(privateKey)
  } catch {
    return null
  }
  if (data.length !== keyBytes) return null

  try {
    return privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, data)
  } catch {
    let raw: Buffer
    try {
      raw = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, data)
    } catch {
      return null
    }
    if (raw.length < 12 || raw[0] !== 0 || raw[1] !== 2) return null

    let separator = -1
    for (let i = 2; i < raw.length; i++) {
      if (raw[i] === 0) {
        separator = i
        break
      }
    }
    if (separator < 10) return null
    return raw.subarray(separator + 1)
  }
}

export function signPasswordToken(privateKey: string, password: string): string {
  const passwordHash = hashPassword(password)
  const sign = createSign('SHA256')
  sign.update(passwordHash)
  sign.end()
  return sign.sign(privateKey, 'base64')
}

export function requiresAuth(): boolean {
  return cachedAuth?.strategy === 'network'
}

export function hasPassword(): boolean {
  return cachedAuth?.encryptedPassword != null && cachedAuth.encryptedPassword.length > 0
}

export async function verifyPassword(password: string): Promise<boolean> {
  const encryptedPassword = cachedAuth?.encryptedPassword
  if (!encryptedPassword) return false

  const privateKey = await loadPrivateKey()

  const decrypted = decryptPassword(privateKey, encryptedPassword)
  return decrypted?.toString() === password
}

export async function tokenFromPassword(password: string): Promise<string> {
  const privateKey = await loadPrivateKey()
  return signPasswordToken(privateKey, password)
}

/**
 * Compute a fresh valid session token for the currently configured password,
 * or null when no password is configured (local mode). Used by the MCP
 * self-bootstrap so a session can connect to this very server.
 */
export async function currentSessionToken(): Promise<string | null> {
  const auth = getAuthConfig()
  if (!auth?.encryptedPassword) return null

  const privateKey = await loadPrivateKey()

  const decrypted = decryptPassword(privateKey, auth.encryptedPassword)
  if (!decrypted) return null
  return await tokenFromPassword(decrypted.toString())
}

export async function isValidToken(token: string): Promise<boolean> {
  if (!cachedAuth?.encryptedPassword) return false

  const privateKey = await loadPrivateKey()

  const decrypted = decryptPassword(privateKey, cachedAuth.encryptedPassword)
  if (!decrypted) return false
  const storedPassword = decrypted.toString()
  const storedHash = hashPassword(storedPassword)

  const verify = await import('node:crypto').then((c) => {
    const v = c.createVerify('SHA256')
    v.update(storedHash)
    v.end()
    return v
  })

  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
  return verify.verify(publicKey, token, 'base64')
}
