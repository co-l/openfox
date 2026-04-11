import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createHash, privateDecrypt, createPublicKey } from 'node:crypto'
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

function getKeyPath(): string {
  const authPath = getAuthConfigPath()
  const dir = dirname(authPath)
  return join(dir, 'auth.key')
}

export interface AuthConfig {
  strategy: 'local' | 'network'
  encryptedPassword: string | null
  sessionKey?: string
}

let cachedAuth: AuthConfig | null = null
let cachedPrivateKey: string | null = null

async function loadPrivateKey(): Promise<string> {
  if (cachedPrivateKey) {
    return cachedPrivateKey
  }

  const keyPath = getKeyPath()
  const keyDir = dirname(keyPath)

  try {
    cachedPrivateKey = await readFile(keyPath, 'utf-8')
    return cachedPrivateKey
  } catch {
    const { privateKey } = await import('node:crypto').then(c => c.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }))

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

  try {
    const decrypted = privateDecrypt(
      { key: privateKey, padding: 1 },
      Buffer.from(encryptedPassword, 'base64')
    )
    return decrypted.toString() === password
  } catch {
    return false
  }
}

export async function tokenFromPassword(password: string): Promise<string> {
  const privateKey = await loadPrivateKey()
  const passwordHash = hashPassword(password)
  
  const sign = await import('node:crypto').then(c => {
    const s = c.createSign('SHA256')
    s.update(passwordHash)
    s.end()
    return s.sign(privateKey, 'base64')
  })
  
  return sign
}

export async function isValidToken(token: string): Promise<boolean> {
  if (!cachedAuth?.encryptedPassword) return false

  const privateKey = await loadPrivateKey()

  try {
    const decrypted = privateDecrypt(
      { key: privateKey, padding: 1 },
      Buffer.from(cachedAuth.encryptedPassword, 'base64')
    )
    const storedPassword = decrypted.toString()
    const storedHash = hashPassword(storedPassword)

    const verify = await import('node:crypto').then(c => {
      const v = c.createVerify('SHA256')
      v.update(storedHash)
      v.end()
      return v
    })

    const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
    return verify.verify(publicKey, token, 'base64')
  } catch {
    return false
  }
}