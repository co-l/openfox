import { Router } from 'express'
import type { Request } from 'express'
import { spawn } from 'node:child_process'
import { VERSION } from '../../constants.js'

export interface AutoUpdateRoutesOptions {
  requireAuth?: (req: Request) => Promise<boolean>
}

let updateInProgress = false

export function resetUpdateInProgress(): void {
  updateInProgress = false
}

function isRunningAsService(): boolean {
  return process.env['OPENFOX_SERVICE'] === 'true'
}

export function createAutoUpdateRoutes(options: AutoUpdateRoutesOptions = {}): Router {
  const router = Router()

  router.get('/check', async (req, res) => {
    const isTest = req.query['test'] === '1'
    const isService = isRunningAsService()

    const current = VERSION

    if (isTest) {
      res.json({ current: '1.0.0', latest: '1.1.0', isUpdateAvailable: true, isService })
      return
    }

    try {
      const latest = await new Promise<string>((resolve, reject) => {
        const child = spawn('npm', ['view', 'openfox', 'version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        child.stdout?.on('data', (data) => {
          stdout += data.toString()
        })
        child.on('close', (code) => {
          if (code === 0) {
            resolve(stdout.trim())
          } else {
            reject(new Error(`npm view exited with code ${code}`))
          }
        })
        child.on('error', reject)
        setTimeout(() => {
          child.kill()
          reject(new Error('npm view timed out'))
        }, 10_000)
      })

      const isUpdateAvailable = current !== latest
      res.json({ current, latest, isUpdateAvailable, isService })
    } catch {
      res.json({ current, latest: current, isUpdateAvailable: false, isService })
    }
  })

  router.post('/', async (req, res) => {
    if (options.requireAuth) {
      const authorized = await options.requireAuth(req)
      if (!authorized) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
    }

    if (updateInProgress) {
      res.status(409).json({ error: 'Update already in progress' })
      return
    }

    try {
      let stderr = ''
      const isService = isRunningAsService()
      const updateCmd = isService ? 'openfox update --service' : 'openfox update'
      const child = spawn('bash', ['-c', updateCmd], {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      })

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          stderr += data.toString()
        })
      }

      child.unref()
      updateInProgress = true

      child.on('close', () => {
        updateInProgress = false
      })

      setTimeout(() => {
        if (stderr) {
          console.error('[auto-update] subprocess error:', stderr)
        }
        updateInProgress = false
      }, 30_000)

      res.json({ success: true, isService })
    } catch (err) {
      updateInProgress = false
      res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed to start' })
    }
  })

  return router
}
