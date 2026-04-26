#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'

const TIMEOUT_MS = 300000 // 5 minutes

async function main() {
  console.log('[publish-e2e] Starting full-stack E2E test...')

  const timestamp = Date.now()
  const workdir = join(tmpdir(), `openfox-publish-e2e-${timestamp}`)
  await mkdir(workdir, { recursive: true })

  console.log(`[publish-e2e] Workdir: ${workdir}`)

  // Environment for the test - isolated config dir
  const configDir = join(tmpdir(), `openfox-publish-e2e-config-${timestamp}`)
  await mkdir(configDir, { recursive: true })

  const env = {
    ...process.env,
    HOME: configDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: configDir,
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error('[publish-e2e] TIMEOUT: Test did not complete within 5 minutes')
      child.kill('SIGTERM')
      reject(new Error('Test timeout'))
    }, TIMEOUT_MS)

    // Run playwright test with the specific config
    // The test file handles its own server lifecycle
    const child = spawn('npx', ['playwright', 'test', 'full-stack.spec.ts', '--config=e2e-playwright/playwright.publish.config.ts'], {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    })

    child.on('close', async (code) => {
      clearTimeout(timeout)
      // Cleanup temp dirs
      try {
        await rm(workdir, { recursive: true, force: true })
        await rm(configDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
      if (code === 0) {
        console.log('[publish-e2e] SUCCESS: All tests passed')
        resolve()
      } else {
        console.error(`[publish-e2e] FAILED: Tests exited with code ${code}`)
        reject(new Error(`Test exited with code ${code}`))
      }
    })

    child.on('error', async (err) => {
      clearTimeout(timeout)
      try {
        await rm(workdir, { recursive: true, force: true })
        await rm(configDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
      console.error(`[publish-e2e] ERROR: ${err.message}`)
      reject(err)
    })
  })
}

main().catch((err) => {
  console.error('[publish-e2e] Fatal error:', err.message)
  process.exit(1)
})