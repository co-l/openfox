import { Router } from 'express'
import type { Request } from 'express'
import { spawn } from 'node:child_process'
import { VERSION } from '../../constants.js'

export interface AutoUpdateRoutesOptions {
  requireAuth?: (req: Request) => Promise<boolean>
}

let updateInProgress = false

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

interface VersionCache {
  data: { current: string; latest: string; isUpdateAvailable: boolean; isService: boolean } | null
  timestamp: number
}

const versionCache: VersionCache = {
  data: null,
  timestamp: 0,
}

export function resetUpdateInProgress(): void {
  updateInProgress = false
}

export function resetVersionCache(): void {
  versionCache.data = null
  versionCache.timestamp = 0
}

function isRunningAsService(): boolean {
  return process.env['OPENFOX_SERVICE'] === 'true'
}

const UPDATE_TIMEOUT = 120_000

async function checkAuth(req: Request, opts: AutoUpdateRoutesOptions): Promise<boolean> {
  if (opts.requireAuth) {
    const authorized = await opts.requireAuth(req)
    if (!authorized) {
      return false
    }
  }
  return true
}

function isDevMode(): boolean {
  return process.env['NODE_ENV'] === 'development'
}

async function getLatestDevelopVersion(): Promise<string> {
  return new Promise<string>((resolve) => {
    const fetchChild = spawn('git', ['fetch', 'upstream', 'develop', '--no-tags'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    fetchChild.on('error', (err) => {
      console.error('[auto-update] Git fetch error:', err.message)
      resolve('unknown')
    })

    fetchChild.on('close', (code) => {
      if (code !== 0) {
        console.warn('[auto-update] Git fetch failed, trying without fetch...')
      }

      const tagChild = spawn(
        'bash',
        [
          '-c',
          'git describe --tags --abbrev=0 upstream/develop 2>/dev/null || git describe --tags --abbrev=0 develop 2>/dev/null || echo unknown',
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )

      let tagOutput = ''
      tagChild.stdout?.on('data', (data) => {
        tagOutput += data.toString()
      })

      tagChild.on('close', (tagCode) => {
        if (tagCode === 0 && tagOutput.trim()) {
          resolve(tagOutput.trim())
        } else {
          console.warn('[auto-update] No tags found on develop branch')
          resolve('unknown')
        }
      })

      tagChild.on('error', (err) => {
        console.error('[auto-update] Git tag error:', err.message)
        resolve('unknown')
      })
    })
  })
}

export function createAutoUpdateRoutes(options: AutoUpdateRoutesOptions = {}): Router {
  const router = Router()

  router.get('/check', async (req, res) => {
    const isService = isRunningAsService()
    const isDev = isDevMode()
    const current = VERSION
    const forceRefresh = req.query['force'] === 'true'

    // Check cache first (unless force refresh)
    if (!forceRefresh && versionCache.data && Date.now() - versionCache.timestamp < CACHE_TTL_MS) {
      res.json({ ...versionCache.data, isService })
      return
    }

    try {
      const latest = isDev
        ? await getLatestDevelopVersion()
        : await new Promise<string>((resolve, reject) => {
            // On Windows npm is npm.cmd, not directly spawnable (CVE-2024-27980):
            // go through the shell as a single string (fixed args, avoids DEP0190).
            const win = process.platform === 'win32'
            const child = spawn(win ? 'npm view openfox version' : 'npm', win ? [] : ['view', 'openfox', 'version'], {
              stdio: ['ignore', 'pipe', 'pipe'],
              shell: win,
              windowsHide: true,
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

      const currentVersion = isDev ? current.replace(/-dev$/, '') : current
      const latestVersion = latest.replace(/^v/, '')
      const isUpdateAvailable = currentVersion !== latestVersion

      // Cache the result
      const now = Date.now()
      versionCache.data = { current, latest, isUpdateAvailable, isService }
      versionCache.timestamp = now

      res.json({ current, latest, isUpdateAvailable, isService })
    } catch (err) {
      console.error('[auto-update] Error in version check:', err instanceof Error ? err.message : err)
      res.json({ current, latest: current, isUpdateAvailable: false, isService })
    }
  })

  router.post('/', async (req, res) => {
    if (!(await checkAuth(req, options))) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    if (updateInProgress) {
      res.status(409).json({ error: 'Update already in progress' })
      return
    }

    updateInProgress = true

    try {
      const isService = isRunningAsService()
      // Single command string through the shell: resolves openfox on PATH on
      // every platform (was hardcoded `bash -c`, broken on Windows).
      const child = spawn('openfox update', {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })
      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      const timeout = setTimeout(() => {
        child.kill()
      }, UPDATE_TIMEOUT)

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve)
        child.on('error', () => resolve(1))
      })

      clearTimeout(timeout)

      if (exitCode === 0) {
        const versionMatch = stdout.match(/Updated: ([\d.]+)/)
        const version = versionMatch?.[1] ?? VERSION
        res.json({ success: true, version, isService })
      } else {
        const error = exitCode === null ? 'Update timed out' : stderr || stdout || 'Update failed'
        res.json({ success: false, error, isService })
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed to start' })
    } finally {
      updateInProgress = false
    }
  })

  router.post('/restart', async (req, res) => {
    if (!(await checkAuth(req, options))) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    try {
      const child = spawn('openfox service restart', {
        detached: true,
        stdio: 'ignore',
        shell: true,
        windowsHide: true,
      })
      child.unref()
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to trigger restart' })
    }
  })

  return router
}
