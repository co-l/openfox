/**
 * Mock LLM Server Setup for E2E Tests
 * 
 * Alternative to setup.ts that uses a mock LLM instead of real vLLM.
 * This allows testing the system without depending on LLM inference.
 * 
 * Usage:
 *   OPENFOX_MOCK_LLM=true npx vitest run
 * 
 * Or import directly in test files:
 *   import { setupMockLLMServer } from './utils/mock-setup.js'
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { config } from 'dotenv'

// Load .env from repository root
config({ path: new URL('../.env', import.meta.url).pathname })

const TEST_PORT = process.env['OPENFOX_TEST_PORT'] ?? '3999'
const MOCK_MODEL = process.env['OPENFOX_MOCK_MODEL'] ?? 'mock-qwen3.5'
const MOCK_BACKEND = process.env['OPENFOX_MOCK_BACKEND'] ?? 'mock'

let serverProcess: ChildProcess | null = null

// Kill any process using the test port
function killProcessOnPort(port: string): void {
  try {
    import('node:child_process').then(({ execSync }) => {
      execSync(`lsof -ti:${port} | xargs -r kill -9 2>/dev/null`, { stdio: 'ignore' })
    })
  } catch {
    // No process to kill
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

export async function setupMockLLMServer(): Promise<void> {
  // Clean up any leftover process
  killProcessOnPort(TEST_PORT)
  await sleep(500)
  
  console.log('\n🚀 Starting OpenFox server with MOCK LLM...')
  console.log(`   Model: ${MOCK_MODEL}`)
  console.log(`   Backend: ${MOCK_BACKEND}`)
  console.log(`   Port: ${TEST_PORT}`)
  
  // Start the server with mock LLM configuration
  // The server will use the mock LLM client when OPENFOX_MOCK_LLM is set
  serverProcess = spawn('node', ['dist/cli/index.js', '--no-browser'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      OPENFOX_PORT: TEST_PORT,
      OPENFOX_DB_PATH: ':memory:',
      // Point to non-existent URL - server will use mock instead
      OPENFOX_VLLM_URL: 'http://localhost:99999/mock',
      OPENFOX_BACKEND: MOCK_BACKEND,
      OPENFOX_MODEL_NAME: MOCK_MODEL,
      OPENFOX_LOG_LEVEL: 'warn',
      OPENFOX_HOST: '127.0.0.1',
      OPENFOX_MOCK_LLM: 'true',  // Flag to enable mock mode
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  
  // Log server output
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
  
  console.log(`✅ Mock LLM server running at ${serverUrl}`)
  
  // Store URL for tests to use
  process.env['OPENFOX_TEST_URL'] = serverUrl
  process.env['OPENFOX_TEST_WS_URL'] = `ws://localhost:${TEST_PORT}/ws`
  process.env['OPENFOX_MOCK_LLM_ENABLED'] = 'true'
  
  // Cleanup on interrupt
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

export async function teardownMockLLMServer(): Promise<void> {
  if (serverProcess && serverProcess.pid) {
    console.log('\n🛑 Stopping mock LLM server...')
    
    try {
      process.kill(-serverProcess.pid, 'SIGTERM')
    } catch {
      serverProcess.kill('SIGTERM')
    }
    
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
    console.log('✅ Mock server stopped')
  }
}
