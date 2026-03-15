/**
 * Global setup for E2E tests.
 * 
 * - Verifies vLLM server is reachable
 * - Starts the OpenFox server on a test port
 * - Exports the server URL for tests to use
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const VLLM_URL = process.env['OPENFOX_VLLM_URL'] ?? 'http://localhost:8000/v1'
const TEST_PORT = process.env['OPENFOX_TEST_PORT'] ?? '3999'

let serverProcess: ChildProcess | null = null

async function checkVllmHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${VLLM_URL}/models`)
    if (!response.ok) return false
    const data = await response.json() as { data?: unknown[] }
    return Array.isArray(data.data) && data.data.length > 0
  } catch {
    return false
  }
}

async function waitForServer(url: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/api/health`)
      if (response.ok) return
    } catch {
      // Server not ready yet
    }
    await sleep(500)
  }
  throw new Error(`Server at ${url} did not become healthy within ${maxAttempts * 0.5}s`)
}

export async function setup(): Promise<void> {
  console.log('\n🔍 Checking vLLM server...')
  
  const vllmHealthy = await checkVllmHealth()
  if (!vllmHealthy) {
    throw new Error(`vLLM server not reachable at ${VLLM_URL}. Please start vLLM before running E2E tests.`)
  }
  console.log(`✅ vLLM server healthy at ${VLLM_URL}`)
  
  console.log('\n🚀 Starting OpenFox server...')
  
  // Start the server with test configuration
  serverProcess = spawn('npm', ['run', 'dev'], {
    cwd: new URL('../packages/server', import.meta.url).pathname,
    env: {
      ...process.env,
      OPENFOX_PORT: TEST_PORT,
      OPENFOX_DB_PATH: ':memory:',
      OPENFOX_VLLM_URL: VLLM_URL,
      OPENFOX_LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  
  // Log server output for debugging
  serverProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.log(`[server] ${msg}`)
  })
  
  serverProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.error(`[server:err] ${msg}`)
  })
  
  serverProcess.on('error', (err) => {
    console.error('Server process error:', err)
  })
  
  // Wait for server to be healthy
  const serverUrl = `http://localhost:${TEST_PORT}`
  await waitForServer(serverUrl)
  console.log(`✅ OpenFox server running at ${serverUrl}`)
  
  // Store URL for tests to use
  process.env['OPENFOX_TEST_URL'] = serverUrl
  process.env['OPENFOX_TEST_WS_URL'] = `ws://localhost:${TEST_PORT}/ws`
}

export async function teardown(): Promise<void> {
  if (serverProcess) {
    console.log('\n🛑 Stopping OpenFox server...')
    serverProcess.kill('SIGTERM')
    
    // Wait for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        serverProcess?.kill('SIGKILL')
        resolve()
      }, 5000)
      
      serverProcess?.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    
    serverProcess = null
    console.log('✅ Server stopped')
  }
}
