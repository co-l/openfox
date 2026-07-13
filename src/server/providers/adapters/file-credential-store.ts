import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { OAuthCredential, ProviderCredentialStore } from './credential-store.js'

interface EncryptedCredential {
  iv: string
  tag: string
  ciphertext: string
}

interface CredentialFile {
  version: 1
  credentials: Record<string, EncryptedCredential>
}

export class FileProviderCredentialStore implements ProviderCredentialStore {
  constructor(
    private readonly path: string,
    private readonly keyPath: string,
  ) {}

  async create(credential: OAuthCredential): Promise<string> {
    const reference = crypto.randomUUID()
    const data = await this.load()
    data.credentials[reference] = await this.encrypt(credential)
    await this.save(data)
    return reference
  }

  async get(reference: string): Promise<OAuthCredential | undefined> {
    const encrypted = (await this.load()).credentials[reference]
    return encrypted ? this.decrypt(encrypted) : undefined
  }

  async set(reference: string, credential: OAuthCredential): Promise<void> {
    const data = await this.load()
    if (!data.credentials[reference]) throw new Error(`Credential not found: ${reference}`)
    data.credentials[reference] = await this.encrypt(credential)
    await this.save(data)
  }

  async delete(reference: string): Promise<void> {
    const data = await this.load()
    if (!data.credentials[reference]) return
    delete data.credentials[reference]
    await this.save(data)
  }

  private async load(): Promise<CredentialFile> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as CredentialFile
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, credentials: {} }
      throw error
    }
  }

  private async save(data: CredentialFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(data), { mode: 0o600 })
  }

  private async loadKey(): Promise<Buffer> {
    try {
      const key = await readFile(this.keyPath)
      if (key.length !== 32) throw new Error('Credential encryption key must be 32 bytes')
      return key
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const key = randomBytes(32)
      await mkdir(dirname(this.keyPath), { recursive: true })
      await writeFile(this.keyPath, key, { mode: 0o600 })
      return key
    }
  }

  private async encrypt(credential: OAuthCredential): Promise<EncryptedCredential> {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', await this.loadKey(), iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credential), 'utf8'), cipher.final()])
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  }

  private async decrypt(encrypted: EncryptedCredential): Promise<OAuthCredential> {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await this.loadKey(),
      Buffer.from(encrypted.iv, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ])
    return JSON.parse(plaintext.toString('utf8')) as OAuthCredential
  }
}
