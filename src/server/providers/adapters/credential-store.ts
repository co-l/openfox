export interface OAuthCredential {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId?: string
  idToken?: string
}

export interface ProviderCredentialStore {
  create(credential: OAuthCredential): Promise<string>
  get(reference: string): Promise<OAuthCredential | undefined>
  set(reference: string, credential: OAuthCredential): Promise<void>
  delete(reference: string): Promise<void>
}

export class MemoryProviderCredentialStore implements ProviderCredentialStore {
  private readonly credentials = new Map<string, OAuthCredential>()

  async create(credential: OAuthCredential): Promise<string> {
    const reference = crypto.randomUUID()
    this.credentials.set(reference, structuredClone(credential))
    return reference
  }

  async get(reference: string): Promise<OAuthCredential | undefined> {
    const credential = this.credentials.get(reference)
    return credential ? structuredClone(credential) : undefined
  }

  async set(reference: string, credential: OAuthCredential): Promise<void> {
    if (!this.credentials.has(reference)) {
      throw new Error(`Credential not found: ${reference}`)
    }
    this.credentials.set(reference, structuredClone(credential))
  }

  async delete(reference: string): Promise<void> {
    this.credentials.delete(reference)
  }
}
