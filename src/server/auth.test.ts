import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { Config } from '../shared/types.js'
import {
  requiresAuth,
  hasPassword,
  verifyPassword,
  isValidToken,
  tokenFromPassword,
  resetAuthCache,
  loadServerAuthConfig,
  getAuthConfig,
  hashPassword,
} from './auth.js'
import { setRuntimeConfig } from './runtime-config.js'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

describe('auth', () => {
  beforeEach(() => {
    resetAuthCache()
    vi.clearAllMocks()
    const config: Config = {
      mode: 'test',
      llm: { baseUrl: '', model: '', backend: 'auto', timeout: 300000, idleTimeout: 300000, disableThinking: false },
      context: { maxTokens: 100000, compactionThreshold: 0.85, compactionTarget: 0.6 },
      agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 120000 },
      server: { port: 0, host: '127.0.0.1' },
      database: { path: ':memory:' },
      logging: { level: 'error' },
      workdir: '/tmp',
    }
    setRuntimeConfig(config)
  })

  describe('requiresAuth', () => {
    it('returns false when no auth config loaded', () => {
      expect(requiresAuth()).toBe(false)
    })

    it('returns false when config is null', () => {
      expect(requiresAuth()).toBe(false)
    })
  })

  describe('hasPassword', () => {
    it('returns false when no auth config', () => {
      expect(hasPassword()).toBe(false)
    })

    it('returns false when encryptedPassword is null', () => {
      expect(hasPassword()).toBe(false)
    })

    it('returns false when encryptedPassword is empty string', () => {
      expect(hasPassword()).toBe(false)
    })
  })

  describe('verifyPassword', () => {
    it('returns false when no auth config', async () => {
      const result = await verifyPassword('testpassword')
      expect(result).toBe(false)
    })
  })

  describe('isValidToken', () => {
    it('returns false when no auth config', async () => {
      const result = await isValidToken('sometoken')
      expect(result).toBe(false)
    })

    it('returns false for empty token', async () => {
      const result = await isValidToken('')
      expect(result).toBe(false)
    })
  })

  describe('tokenFromPassword', () => {
    it('generates a token when no auth config exists (creates keypair)', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)

      const result = await tokenFromPassword('testpassword')
      expect(result).not.toBeNull()
      expect(typeof result).toBe('string')
      expect(result!.length).toBeGreaterThan(0)
    })

    it('generates different tokens for different passwords', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)

      const token1 = await tokenFromPassword('password1')
      const token2 = await tokenFromPassword('password2')
      expect(token1).not.toBe(token2)
    })
  })

  describe('resetAuthCache', () => {
    it('clears the cached auth config', () => {
      resetAuthCache()
      expect(requiresAuth()).toBe(false)
    })
  })

  describe('loadServerAuthConfig', () => {
    it('loads auth config from file in test mode', async () => {
      const mockAuthConfig = { strategy: 'network', encryptedPassword: 'abc123' }
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(mockAuthConfig))

      const result = await loadServerAuthConfig()
      expect(result).toEqual(mockAuthConfig)
    })

    it('returns null when auth file does not exist', async () => {
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))

      const result = await loadServerAuthConfig()
      expect(result).toBeNull()
    })

    it('returns null on corrupted JSON', async () => {
      vi.mocked(readFile).mockResolvedValueOnce('not valid json')

      const result = await loadServerAuthConfig()
      expect(result).toBeNull()
    })

    it('caches config in non-test mode', async () => {
      const config: Config = {
        mode: 'production',
        llm: { baseUrl: '', model: '', backend: 'auto', timeout: 300000, idleTimeout: 300000, disableThinking: false },
        context: { maxTokens: 100000, compactionThreshold: 0.85, compactionTarget: 0.6 },
        agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 120000 },
        server: { port: 0, host: '127.0.0.1' },
        database: { path: ':memory:' },
        logging: { level: 'error' },
        workdir: '/tmp',
      }
      setRuntimeConfig(config)

      const mockAuthConfig = { strategy: 'network', encryptedPassword: 'abc123' }
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(mockAuthConfig))

      await loadServerAuthConfig()
      await loadServerAuthConfig()

      expect(readFile).toHaveBeenCalledTimes(1)
    })

    it('does not cache config in test mode', async () => {
      const config: Config = {
        mode: 'test',
        llm: { baseUrl: '', model: '', backend: 'auto', timeout: 300000, idleTimeout: 300000, disableThinking: false },
        context: { maxTokens: 100000, compactionThreshold: 0.85, compactionTarget: 0.6 },
        agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 120000 },
        server: { port: 0, host: '127.0.0.1' },
        database: { path: ':memory:' },
        logging: { level: 'error' },
        workdir: '/tmp',
      }
      setRuntimeConfig(config)

      const mockAuthConfig = { strategy: 'network', encryptedPassword: 'abc123' }
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockAuthConfig))

      await loadServerAuthConfig()
      await loadServerAuthConfig()

      expect(readFile).toHaveBeenCalledTimes(2)
    })
  })

  describe('getAuthConfig', () => {
    it('returns null when no config loaded', () => {
      resetAuthCache()
      expect(getAuthConfig()).toBeNull()
    })

    it('returns cached config after loading', async () => {
      const mockAuthConfig = { strategy: 'network', encryptedPassword: 'abc123' }
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(mockAuthConfig))

      await loadServerAuthConfig()
      expect(getAuthConfig()).toEqual(mockAuthConfig)
    })
  })

  describe('hashPassword', () => {
    it('produces consistent hash for same password', () => {
      const hash1 = hashPassword('mypassword')
      const hash2 = hashPassword('mypassword')
      expect(hash1).toBe(hash2)
    })

    it('produces different hash for different passwords', () => {
      const hash1 = hashPassword('password1')
      const hash2 = hashPassword('password2')
      expect(hash1).not.toBe(hash2)
    })

    it('produces 64-character hex string', () => {
      const hash = hashPassword('test')
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('requiresAuth with config loaded', () => {
    it('returns true when strategy is network', async () => {
      const mockAuthConfig = { strategy: 'network', encryptedPassword: 'abc123' }
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(mockAuthConfig))
      await loadServerAuthConfig()

      expect(requiresAuth()).toBe(true)
    })

    it('returns false when strategy is local', async () => {
      const mockAuthConfig = { strategy: 'local', encryptedPassword: null }
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(mockAuthConfig))
      await loadServerAuthConfig()

      expect(requiresAuth()).toBe(false)
    })
  })

  describe('hasPassword with config loaded', () => {
    it('returns true when encryptedPassword is set', async () => {
      const mockAuthConfig = { strategy: 'network', encryptedPassword: 'abc123' }
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(mockAuthConfig))
      await loadServerAuthConfig()

      expect(hasPassword()).toBe(true)
    })

    it('returns false when encryptedPassword is null', async () => {
      const mockAuthConfig = { strategy: 'network', encryptedPassword: null }
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(mockAuthConfig))
      await loadServerAuthConfig()

      expect(hasPassword()).toBe(false)
    })

    it('returns false when encryptedPassword is empty string', async () => {
      const mockAuthConfig = { strategy: 'network', encryptedPassword: '' }
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(mockAuthConfig))
      await loadServerAuthConfig()

      expect(hasPassword()).toBe(false)
    })
  })

  describe('verifyPassword with config loaded', () => {
    it('returns true for correct password', async () => {
      const { privateKey, publicKey } = await import('node:crypto').then((c) =>
        c.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        }),
      )

      const encryptedPassword = await import('node:crypto').then((c) =>
        c.publicEncrypt({ key: publicKey, padding: 1 }, Buffer.from('correctpassword')).toString('base64'),
      )

      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ strategy: 'network', encryptedPassword }))
      vi.mocked(readFile).mockResolvedValueOnce(privateKey)

      await loadServerAuthConfig()

      const result = await verifyPassword('correctpassword')
      expect(result).toBe(true)
    })

    it('returns false for incorrect password', async () => {
      const { privateKey, publicKey } = await import('node:crypto').then((c) =>
        c.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        }),
      )

      const encryptedPassword = await import('node:crypto').then((c) =>
        c.publicEncrypt({ key: publicKey, padding: 1 }, Buffer.from('correctpassword')).toString('base64'),
      )

      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ strategy: 'network', encryptedPassword }))
      vi.mocked(readFile).mockResolvedValueOnce(privateKey)

      await loadServerAuthConfig()

      const result = await verifyPassword('wrongpassword')
      expect(result).toBe(false)
    })
  })

  describe('isValidToken with config loaded', () => {
    it('returns true for valid token', async () => {
      const { privateKey, publicKey } = await import('node:crypto').then((c) =>
        c.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        }),
      )

      const password = 'testpassword'
      const passwordHash = hashPassword(password)

      const sign = await import('node:crypto').then((c) => {
        const s = c.createSign('SHA256')
        s.update(passwordHash)
        s.end()
        return s.sign(privateKey, 'base64')
      })

      const encryptedPassword = await import('node:crypto').then((c) =>
        c.publicEncrypt({ key: publicKey, padding: 1 }, Buffer.from(password)).toString('base64'),
      )

      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ strategy: 'network', encryptedPassword }))
      vi.mocked(readFile).mockResolvedValueOnce(privateKey)

      await loadServerAuthConfig()

      const result = await isValidToken(sign)
      expect(result).toBe(true)
    })

    it('returns false for invalid token', async () => {
      const { privateKey, publicKey } = await import('node:crypto').then((c) =>
        c.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        }),
      )

      const encryptedPassword = await import('node:crypto').then((c) =>
        c.publicEncrypt({ key: publicKey, padding: 1 }, Buffer.from('password')).toString('base64'),
      )

      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ strategy: 'network', encryptedPassword }))
      vi.mocked(readFile).mockResolvedValueOnce(privateKey)

      await loadServerAuthConfig()

      const result = await isValidToken('invalidtoken')
      expect(result).toBe(false)
    })

    it('returns false when no encryptedPassword in config', async () => {
      const mockAuthConfig = { strategy: 'network', encryptedPassword: null }
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(mockAuthConfig))

      await loadServerAuthConfig()

      const result = await isValidToken('sometoken')
      expect(result).toBe(false)
    })
  })

  describe('tokenFromPassword with config loaded', () => {
    it('generates valid signature token', async () => {
      const { privateKey, publicKey } = await import('node:crypto').then((c) =>
        c.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        }),
      )

      const encryptedPassword = await import('node:crypto').then((c) =>
        c.publicEncrypt({ key: publicKey, padding: 1 }, Buffer.from('password')).toString('base64'),
      )

      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ strategy: 'network', encryptedPassword }))
      vi.mocked(readFile).mockResolvedValueOnce(privateKey)

      await loadServerAuthConfig()

      const token = await tokenFromPassword('password')

      const verify = await import('node:crypto').then((c) => {
        const v = c.createVerify('SHA256')
        v.update(hashPassword('password'))
        v.end()
        return v
      })

      const publicKeyObj = await import('node:crypto').then((c) => c.createPublicKey(privateKey))
      const exportedPublicKey = publicKeyObj.export({ type: 'spki', format: 'pem' })

      const isValid = verify.verify(exportedPublicKey, token, 'base64')
      expect(isValid).toBe(true)
    })
  })
})
