#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { resolveLlmMode } from './publish-e2e-llm.js'

// The local model server is fast and local; a cloud API fallback needs headroom.
const TIMEOUT_MS = resolveLlmMode(process.env['OPENFOX_PUBLISH_E2E_LLM']) === 'prod' ? 600000 : 300000

async function main() {
  const llmMode = resolveLlmMode(process.env['OPENFOX_PUBLISH_E2E_LLM'])
  console.log('[publish-e2e] Starting full-stack E2E test...')
  console.log(
    llmMode === 'prod'
      ? '[publish-e2e] LLM mode: prod (using the provider from the production config)'
      : '[publish-e2e] LLM mode: local (hardcoded local model server)',
  )

  // Create temp workdir for the test
  const timestamp = Date.now()
  const workdir = join(tmpdir(), `openfox-publish-e2e-${timestamp}`)
  await mkdir(workdir, { recursive: true })

  console.log(`[publish-e2e] Workdir: ${workdir}`)

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error(`[publish-e2e] TIMEOUT: Test did not complete within ${TIMEOUT_MS / 60000} minutes`)
      child.kill('SIGTERM')
      reject(new Error('Test timeout'))
    }, TIMEOUT_MS)

    // Run playwright test - it handles its own config isolation when spawning server
    const child = spawn(
      'npx',
      ['playwright', 'test', 'full-stack.spec.ts', '--config=e2e-playwright/playwright.publish.config.ts'],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
      },
    )

    child.on('close', async (code) => {
      clearTimeout(timeout)
      // Cleanup temp workdir (server process cleanup is handled in test afterAll)
      try {
        await rm(workdir, { recursive: true, force: true })
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
