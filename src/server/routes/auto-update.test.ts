import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { createAutoUpdateRoutes, resetUpdateInProgress } from './auto-update.js'

describe('Auto Update Routes', () => {
  let app: express.Express
  let server: ReturnType<typeof app.listen>
  let baseUrl: string

  beforeEach(async () => {
    app = express()
    app.use(express.json())
    app.use('/api/auto-update', createAutoUpdateRoutes())

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as any).port}`
        resolve()
      })
    })
  })

  afterEach(() => {
    server?.close()
    resetUpdateInProgress()
  })

  describe('GET /api/auto-update/check', () => {
    it('returns current version and latest', async () => {
      const res = await fetch(`${baseUrl}/api/auto-update/check`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        current: string
        latest: string
        isUpdateAvailable: boolean
        isService: boolean
      }
      expect(typeof body.current).toBe('string')
      expect(typeof body.latest).toBe('string')
      expect(typeof body.isUpdateAvailable).toBe('boolean')
      expect(typeof body.isService).toBe('boolean')
    })

    it('returns mock versions when test=1', async () => {
      const res = await fetch(`${baseUrl}/api/auto-update/check?test=1`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        current: string
        latest: string
        isUpdateAvailable: boolean
        isService: boolean
      }
      expect(body.current).toBe('1.0.0')
      expect(body.latest).toBe('1.1.0')
      expect(body.isUpdateAvailable).toBe(true)
      expect(typeof body.isService).toBe('boolean')
    })

    it('returns isUpdateAvailable false when current matches latest', async () => {
      const res = await fetch(`${baseUrl}/api/auto-update/check`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { current: string; latest: string; isUpdateAvailable: boolean }
      expect(body.isUpdateAvailable).toBe(body.current !== body.latest)
    })
  })

  describe('POST /api/auto-update (no auth required)', () => {
    it('returns 200 immediately and does not block', async () => {
      const start = Date.now()
      const res = await fetch(`${baseUrl}/api/auto-update`, { method: 'POST' })
      const elapsed = Date.now() - start

      expect(res.status).toBe(200)
      const body = (await res.json()) as { success: boolean; isService: boolean }
      expect(body.success).toBe(true)
      expect(typeof body.isService).toBe('boolean')
      expect(elapsed).toBeLessThan(2000)
    })
  })
})

describe('Auto Update Routes (auth required)', () => {
  let app: express.Express
  let server: ReturnType<typeof app.listen>
  let baseUrl: string
  let validToken: string

  beforeEach(async () => {
    validToken = 'Bearer valid-token-123'
    app = express()
    app.use(express.json())
    app.use(
      '/api/auto-update',
      createAutoUpdateRoutes({
        requireAuth: (req) => {
          const authHeader = req.headers['authorization']
          if (!authHeader || authHeader !== validToken) {
            return Promise.resolve(false)
          }
          return Promise.resolve(true)
        },
      }),
    )

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as any).port}`
        resolve()
      })
    })
  })

  afterEach(() => {
    server?.close()
    resetUpdateInProgress()
  })

  describe('POST /api/auto-update', () => {
    it('rejects request without authorization header', async () => {
      const res = await fetch(`${baseUrl}/api/auto-update`, { method: 'POST' })
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('Unauthorized')
    })

    it('rejects request with invalid token', async () => {
      const res = await fetch(`${baseUrl}/api/auto-update`, {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
      })
      expect(res.status).toBe(401)
    })

    it('accepts request with valid token', async () => {
      const res = await fetch(`${baseUrl}/api/auto-update`, {
        method: 'POST',
        headers: { Authorization: validToken },
      })
      expect(res.status).toBe(200)
    })
  })
})
