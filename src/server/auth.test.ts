import { describe, expect, it, beforeEach } from 'vitest'
import type { Config } from '../shared/types.js'
import {
  requiresAuth,
  hasPassword,
  verifyPassword,
  isValidToken,
  tokenFromPassword,
  resetAuthCache,
} from './auth.js'
import { setRuntimeConfig } from './runtime-config.js'

describe('auth', () => {
  beforeEach(() => {
    resetAuthCache()
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
      const result = await tokenFromPassword('testpassword')
      expect(result).not.toBeNull()
      expect(typeof result).toBe('string')
      expect(result!.length).toBeGreaterThan(0)
    })

    it('generates different tokens for different passwords', async () => {
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
})