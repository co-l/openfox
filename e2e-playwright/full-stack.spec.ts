import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_PROMPT = 'this is just a test - add a "this is just a test criteria, validate it without doing anything" criteria (but do not validate it just yet, not in planning mode!)'

interface TestContext {
  serverUrl: string
  serverProcess: ChildProcess | null
  workdir: string
  cleanupFn: () => Promise<void>
}

async function setupTestEnvironment(): Promise<TestContext> {
  const timestamp = Date.now()
  const workdir = join(tmpdir(), `openfox-e2e-${timestamp}`)
  const configDir = join(tmpdir(), `openfox-e2e-config-${timestamp}`)
  await mkdir(workdir, { recursive: true })
  await mkdir(configDir, { recursive: true })

  // Create a minimal config file in temp location for isolated testing
  const configJson = {
    workspace: { workdir },
    providers: [{
      id: 'e2e-provider',
      name: 'E2E Provider',
      url: 'http://192.168.1.223:8000',
      backend: 'vllm' as const,
      models: [],
      isActive: true,
      createdAt: new Date().toISOString(),
    }],
    activeProviderId: 'e2e-provider',
    defaultModelSelection: { providerId: 'e2e-provider' },
  }

  const { writeFile, mkdir: mkd } = await import('node:fs/promises')
  const devConfigDir = join(configDir, 'openfox-dev')
  await mkd(devConfigDir, { recursive: true })
  await writeFile(join(devConfigDir, 'config.json'), JSON.stringify(configJson, null, 2), 'utf-8')

  const port = 10669 + (timestamp % 1000)
  const serverUrl = `http://localhost:${port}`

  // Spawn server with isolated config dir so we don't pick up user config with network auth
  const serverEnv = {
    ...process.env,
    HOME: configDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: configDir,
    OPENFOX_PORT: String(port),
    OPENFOX_DB_PATH: ':memory:',
    OPENFOX_WORKDIR: workdir,
    OPENFOX_LLM_URL: 'http://192.168.1.223:8000',
    OPENFOX_BACKEND: 'vllm',
    OPENFOX_DEV: 'true',
    OPENFOX_LOG_LEVEL: 'warn',
    OPENFOX_MOCK_LLM: 'false',
  }

  // Start the dev server
  const serverProcess = spawn('npm', ['run', 'dev'], {
    cwd: process.cwd(),
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Wait for server to be ready
  const maxWait = 60000
  const startTime = Date.now()
  let serverReady = false

  while (Date.now() - startTime < maxWait) {
    try {
      const response = await fetch(`${serverUrl}/api/health`)
      if (response.ok) {
        serverReady = true
        break
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  if (!serverReady) {
    serverProcess.kill()
    throw new Error('Server failed to start within timeout')
  }

  const cleanupFn = async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    try {
      await rm(workdir, { recursive: true, force: true })
      await rm(configDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }

  return { serverUrl, serverProcess, workdir, cleanupFn }
}

test.describe('Full-stack Build & Verify E2E', () => {
  let ctx: TestContext

  test.beforeAll(async () => {
    ctx = await setupTestEnvironment()
  })

  test.afterAll(async () => {
    await ctx.cleanupFn()
  })

  test('complete workflow: onboarding -> project -> session -> build&verify', async ({ page }) => {
    const { serverUrl, workdir } = ctx

    // Navigate to onboarding
    await page.goto(`${serverUrl}/onboarding`)
    await page.waitForLoadState('networkidle')

    // Handle password modal if it appears (network auth in user config)
    const passwordInput = page.locator('input[placeholder="Enter password"]')
    try {
      const hasPasswordModal = await passwordInput.isVisible({ timeout: 2000 })
      if (hasPasswordModal) {
        test.skip()
        return
      }
    } catch {
      // No password modal, proceed
    }

    // Step 1: Add LLM provider
    await page.getByTestId('onboarding-add-provider-button').click()
    await page.getByTestId('onboarding-provider-url-input').fill('http://192.168.1.223:8000')

    // Test connection and wait for result
    await page.getByTestId('onboarding-test-connection-button').click()
    await page.waitForTimeout(3000)

    // Add provider
    await page.getByTestId('onboarding-add-provider-submit-button').click()
    await page.waitForTimeout(500)

    // Continue to step 2
    await page.getByTestId('onboarding-continue-button').click()
    await page.waitForLoadState('networkidle')

    // Step 2: Set workdir
    await page.getByTestId('onboarding-workdir-input').fill(workdir)
    await page.getByTestId('onboarding-workdir-continue-button').click()
    await page.waitForLoadState('networkidle')

    // Step 3: Skip vision
    await page.getByTestId('onboarding-skip-button').click()
    await page.waitForTimeout(1000)

    // After skip, the app does history.back() - if providers loaded, we go to home
    // If still on onboarding, manually navigate to home
    if (page.url().includes('/onboarding')) {
      await page.goto(`${serverUrl}/`)
      await page.waitForLoadState('networkidle')
    }

    // Verify we're on the home page (not onboarding)
    expect(page.url()).toContain(serverUrl)
    expect(page.url()).not.toContain('/onboarding')

    // Wait for content to load
    await page.waitForTimeout(2000)

    // Click "Open Project" to open the modal
    await page.getByRole('button', { name: 'Open Project' }).click()
    await page.waitForTimeout(500)

    // Click "Create Project"
    await page.getByTestId('open-project-create-button').click()
    await page.waitForTimeout(500)

    // Fill in project name
    await page.getByTestId('create-project-name-input').fill('e2e-test-project')
    await page.getByTestId('create-project-submit-button').click()

    // Wait for project page to load
    await page.waitForURL(/\/p\/[a-f0-9-]+/)
    await page.waitForLoadState('networkidle')

    // Click "Create New Session"
    await page.getByTestId('create-new-session-button').click()

    // Wait for session to be created and redirect
    await page.waitForURL(/\/p\/[a-f0-9-]+\/s\/[a-f0-9-]+/)
    await page.waitForLoadState('networkidle')

    // Type the prompt
    await page.getByTestId('chat-input-textarea').fill(TEST_PROMPT)

    // Send the message
    await page.getByTestId('chat-send-button').click()

    // Wait for agent response with workflow buttons
    // The agent should add the criteria and show a workflow button
    await page.waitForSelector('[data-testid="workflow-run-button"]', { timeout: 120000 })

    // Click the workflow button to start Build & Verify
    await page.getByTestId('workflow-run-button').first().click()

    // Wait for task.completed event - stats are displayed after Build & Verify completes
    // The format varies but typically includes "Build & Verify" heading and stats
    await page.waitForSelector('text=Build & Verify', { timeout: 120000 })
    await page.waitForTimeout(2000)

    // Verify stats are present by checking for key indicators
    const pageContent = await page.content()
    const hasTime = /total time|Total time|\d+\.\d+s/i.test(pageContent)
    const hasToolCalls = /tool calls|Tool calls/i.test(pageContent) || /\d+\s*(tool calls?)/i.test(pageContent)
    const hasTokens = /tokens|Tokens/i.test(pageContent)

    expect(hasTime || hasToolCalls || hasTokens).toBeTruthy()
  })
})