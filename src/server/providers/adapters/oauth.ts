export interface PkcePair {
  verifier: string
  challenge: string
}

export async function createPkcePair(): Promise<PkcePair> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const random = crypto.getRandomValues(new Uint8Array(43))
  const verifier = Array.from(random, (byte) => chars[byte % chars.length]).join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: Buffer.from(digest).toString('base64url') }
}

export function createOAuthState(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
}
