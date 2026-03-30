/**
 * Global setup for E2E tests.
 * 
 * Starts OpenFox server with mock LLM for fast deterministic testing.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { config } from 'dotenv'
import { rm, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

config({ path: new URL('../.env', import.meta.url).pathname })

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_CONFIG_DIR = join(__dirname, '.openfox-test')

const TEST_PORT = process.env['OPENFOX_TEST_PORT'] ?? '3999'
let serverProcess: ChildProcess | null = null

function killProcessOnPort(port: string): void {
  try {
    execSync(`lsof -ti:${port} | xargs -r kill -9 2>/dev/null`, { stdio: 'ignore' })
  } catch {
    // No process to kill
  }
}

async function waitForServer(url: string, maxAttempts = 40): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/api/health`)
      if (response.ok) return
    } catch {
      // Server not ready
    }
    await sleep(250)
  }
  throw new Error(`Server not healthy within ${maxAttempts * 0.25}s`)
}

export async function setup(): Promise<void> {
  await rm(TEST_CONFIG_DIR, { recursive: true, force: true })
  await mkdir(TEST_CONFIG_DIR, { recursive: true })
  
  killProcessOnPort(TEST_PORT)
  await sleep(300)

  const verbose = process.env['OPENFOX_TEST_VERBOSE'] === 'true'
  if (verbose) {
    console.log('\n🚀 Starting OpenFox with Mock LLM...')
  }

  // Spawn with completely isolated stdio to avoid vitest conflicts
  serverProcess = spawn('node', ['dist/cli/index.js', '--no-browser'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      OPENFOX_PORT: TEST_PORT,
      OPENFOX_DB_PATH: ':memory:',
      OPENFOX_HOST: '127.0.0.1',
      OPENFOX_LOG_LEVEL: 'error',
      OPENFOX_MOCK_LLM: 'true',
      OPENFOX_MODEL_NAME: 'mock-model',
      OPENFOX_MODE: 'test',
    },
    stdio: 'ignore',
    detached: true,
  })

  serverProcess.unref()

  const serverUrl = `http://localhost:${TEST_PORT}`
  await waitForServer(serverUrl)

  if (verbose) {
    console.log(`✅ Mock server ready at ${serverUrl}`)
  }

  process.env['OPENFOX_TEST_URL'] = serverUrl
  process.env['OPENFOX_TEST_WS_URL'] = `ws://localhost:${TEST_PORT}/ws`

  const cleanup = () => {
    if (serverProcess?.pid) {
      try { process.kill(-serverProcess.pid, 'SIGKILL') } catch { serverProcess?.kill('SIGKILL') }
    }
    killProcessOnPort(TEST_PORT)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

export async function teardown(): Promise<void> {
  if (serverProcess?.pid) {
    const verbose = process.env['OPENFOX_TEST_VERBOSE'] === 'true'
    if (verbose) {
      console.log('\n🛑 Stopping server...')
    }
    try { process.kill(-serverProcess.pid, 'SIGTERM') } catch { serverProcess?.kill('SIGTERM') }
    await sleep(500)
    try { process.kill(-serverProcess.pid, 'SIGKILL') } catch { /* already dead */ }
    serverProcess = null
    if (verbose) {
      console.log('✅ Stopped')
    }
  }
  
  await rm(TEST_CONFIG_DIR, { recursive: true, force: true })
}
