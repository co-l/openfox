/**
 * Global setup for E2E tests.
 * 
 * - Loads environment from root .env file
 * - Verifies vLLM server is reachable
 * - Starts the OpenFox server on a test port
 * - Exports the server URL for tests to use
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { config } from 'dotenv'

// Load .env from repository root
config({ path: new URL('../.env', import.meta.url).pathname })

const VLLM_URL = process.env['OPENFOX_VLLM_URL'] ?? 'http://localhost:8000/v1'
const TEST_PORT = process.env['OPENFOX_TEST_PORT'] ?? '3999'

let serverProcess: ChildProcess | null = null

// Kill any process using the test port (cleanup from previous interrupted runs)
function killProcessOnPort(port: string): void {
  try {
    execSync(`lsof -ti:${port} | xargs -r kill -9 2>/dev/null`, { stdio: 'ignore' })
  } catch {
    // No process to kill, that's fine
  }
}

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
  // Clean up any leftover process from previous interrupted runs
  killProcessOnPort(TEST_PORT)
  await sleep(500) // Give OS time to release the port
  
  console.log('\n🔍 Checking vLLM server...')
  
  const vllmHealthy = await checkVllmHealth()
  if (!vllmHealthy) {
    throw new Error(`vLLM server not reachable at ${VLLM_URL}. Please start vLLM before running E2E tests.`)
  }
  console.log(`✅ vLLM server healthy at ${VLLM_URL}`)
  
  console.log('\n🚀 Starting OpenFox server...')
  
  // Start the server with test configuration
  // Use tsx directly to avoid auto-restarts on file changes
  // Use detached: true to create a process group for clean shutdown
  serverProcess = spawn('tsx', ['src/server/index.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      OPENFOX_PORT: TEST_PORT,
      OPENFOX_DB_PATH: ':memory:',
      OPENFOX_VLLM_URL: VLLM_URL,
      OPENFOX_LOG_LEVEL: 'warn',
      OPENFOX_DISABLE_THINKING: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
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
  
  // Ensure model is auto-detected (server's initModel runs async)
  const refreshRes = await fetch(`${serverUrl}/api/model/refresh`, { method: 'POST' })
  const modelInfo = await refreshRes.json() as { model: string; source: string }
  console.log(`✅ OpenFox server running at ${serverUrl} (model: ${modelInfo.model})`)
  
  // Store URL for tests to use
  process.env['OPENFOX_TEST_URL'] = serverUrl
  process.env['OPENFOX_TEST_WS_URL'] = `ws://localhost:${TEST_PORT}/ws`
  
  // Ensure cleanup on interrupt (ctrl+c)
  const cleanup = () => {
    if (serverProcess?.pid) {
      try {
        process.kill(-serverProcess.pid, 'SIGKILL')
      } catch {
        serverProcess?.kill('SIGKILL')
      }
    }
    killProcessOnPort(TEST_PORT)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

export async function teardown(): Promise<void> {
  if (serverProcess && serverProcess.pid) {
    console.log('\n🛑 Stopping OpenFox server...')
    
    // Kill the entire process group (tsx watch spawns child processes)
    try {
      process.kill(-serverProcess.pid, 'SIGTERM')
    } catch {
      // Process group might not exist, try direct kill
      serverProcess.kill('SIGTERM')
    }
    
    // Wait for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          if (serverProcess?.pid) {
            process.kill(-serverProcess.pid, 'SIGKILL')
          }
        } catch {
          serverProcess?.kill('SIGKILL')
        }
        resolve()
      }, 3000)
      
      serverProcess?.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    
    serverProcess = null
    console.log('✅ Server stopped')
  }
}
