import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  resolveLlmMode,
  resolveProdConfigPath,
  selectProdLlm,
  type ProdLlmSelection,
} from '../scripts/publish-e2e-llm.js'

const TEST_PROMPT =
  'this is just a test - add a "this is just a test criteria, validate it without doing anything" criteria (but do not validate it just yet, not in planning mode!)'

// Opt-in fallback: when the local model server is unavailable, drive the
// onboarding wizard with the provider configured in the production config.
// Default (unset / `local`) keeps the hardcoded local flow untouched.
const IS_PROD_LLM = resolveLlmMode(process.env['OPENFOX_PUBLISH_E2E_LLM']) === 'prod'
const TEST_TIMEOUT_MS = IS_PROD_LLM ? 300_000 : 180_000
const SAVE_READY_TIMEOUT_MS = IS_PROD_LLM ? 90_000 : 30_000

function loadProdLlm(): ProdLlmSelection {
  const path = resolveProdConfigPath(process.env)
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    throw new Error(`OPENFOX_PUBLISH_E2E_LLM=prod but no production config was found at ${path}`)
  }
  return selectProdLlm(JSON.parse(raw) as unknown, process.env['OPENFOX_PUBLISH_E2E_PROVIDER'])
}

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
  // No pre-configured providers — simulates a fresh install; provider added via onboarding UI
  const configJson = {
    workspace: { workdir },
    server: { openBrowser: false },
  }

  const { writeFile, mkdir: mkd } = await import('node:fs/promises')
  const prodConfigDir = join(configDir, 'openfox')
  await mkd(prodConfigDir, { recursive: true })
  await writeFile(join(prodConfigDir, 'config.json'), JSON.stringify(configJson, null, 2), 'utf-8')

  const port = 10669 + (timestamp % 1000)
  const serverUrl = `http://localhost:${port}`

  // Spawn server with isolated config dir so we don't pick up user config with network auth
  // No LLM env vars — simulates a real user discovering OpenFox with zero config.
  // The provider URL is entered manually in the UI during onboarding.
  const serverEnv = {
    ...process.env,
    HOME: configDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: configDir,
    OPENFOX_PORT: String(port),
    OPENFOX_DB_PATH: ':memory:',
    OPENFOX_WORKDIR: workdir,
    OPENFOX_LOG_LEVEL: 'warn',
    OPENFOX_MOCK_LLM: 'false',
  }

  // Start the built production server (tests the dist bundle, not tsx-transpiled source)
  const serverProcess = spawn('node', ['dist/cli/index.js'], {
    cwd: process.cwd(),
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  serverProcess.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  // Wait for server to be ready, but fail fast if process dies early
  const maxWait = 60000
  const startTime = Date.now()
  let serverReady = false

  while (Date.now() - startTime < maxWait) {
    // Check if process crashed before health check
    if (serverProcess.exitCode !== null) {
      serverProcess.kill()
      throw new Error(`Server exited early (code ${serverProcess.exitCode}): ${stderr.slice(0, 500)}`)
    }

    try {
      const response = await fetch(`${serverUrl}/api/health`)
      if (response.ok) {
        serverReady = true
        break
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  if (!serverReady) {
    serverProcess.kill()
    throw new Error('Server failed to start within timeout')
  }

  const cleanupFn = async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 1000))
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
    test.setTimeout(120_000)
    ctx = await setupTestEnvironment()
  })

  test.afterAll(async () => {
    await ctx.cleanupFn()
  })

  test('complete workflow: onboarding -> project -> session -> build&verify', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    const { serverUrl } = ctx

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

    // Step 1: Add LLM provider via the ProviderModal wizard
    await page.getByTestId('onboarding-add-provider-button').click()

    if (IS_PROD_LLM) {
      // Fallback mode: drive the wizard with the provider configured in the
      // user's production config (used when the local model server is down).
      const { url, apiKey, model } = loadProdLlm()

      // "Other" preset → generic OpenAI-compatible API (backend unknown, not local).
      await page.getByRole('button', { name: 'Other', exact: true }).click()
      await page.getByTestId('provider-modal-url').fill(url)
      await page.getByTestId('provider-modal-api-key').fill(apiKey)

      const modelsResponse = page.waitForResponse((response) => response.url().includes('/api/providers/models'), {
        timeout: 60000,
      })
      await page.getByTestId('provider-modal-next').click()
      // Wait for the automatic catalog fetch to settle so a manual selection is
      // not dropped by a late-arriving response.
      await modelsResponse
      await page.waitForTimeout(500)

      // Pin the exact production model — the catalog may expose many, and only a
      // manual add guarantees the one we intend to test.
      await page.getByTestId('provider-modal-manual-model-input').fill(model)
      await page.getByTestId('provider-modal-manual-model-add').click()
    } else {
      // Modal step 1: click the vLLM preset first (sets backend type, name, and URL),
      // then override the URL with the test server address
      await page.getByRole('button', { name: 'vLLM' }).click()
      await page.getByTestId('provider-modal-url').fill('http://192.168.1.223:8000')
      await page.getByTestId('provider-modal-next').click()
    }

    // Modal step 2: auto-config runs automatically — wait for it to finish, then
    // save directly (no separate review step).
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="provider-modal-save"]') as HTMLButtonElement | null
        return btn && !btn.disabled
      },
      { timeout: SAVE_READY_TIMEOUT_MS },
    )

    await page.getByTestId('provider-modal-save').click()

    // Onboarding auto-advances to the workdir step after saving the first provider.
    // (No separate "Continue" button on the provider step.)

    // Step 2: Set workdir
    await page.getByTestId('onboarding-workdir-input').waitFor({ state: 'visible', timeout: 15000 })
    await page.getByTestId('onboarding-workdir-continue-button').click()
    await page.waitForLoadState('networkidle')

    // Step 3: Skip vision
    await page.getByTestId('onboarding-skip-button').click()

    // After onboarding completes, navigate to home
    await page.goto(`${serverUrl}/`)
    await page.waitForLoadState('networkidle')

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

    // The workflow opens with a user step asking where to work. Pick the
    // "Work in current workspace" option (no new workspace) so the rest of
    // the pipeline runs in place.
    await page.getByRole('button', { name: 'Work in current workspace' }).waitFor({ state: 'visible', timeout: 30000 })
    await page.getByRole('button', { name: 'Work in current workspace' }).click()

    // Wait for Build & Verify to complete — task completed card appears with stats
    await page.waitForSelector('[data-testid="task-completed-card"]', { timeout: 120000 })
    await page.waitForTimeout(1000)

    // Verify stats are present
    const pageContent = await page.content()
    const hasTime = /total time|Total time|\d+\.\d+s/i.test(pageContent)
    const hasToolCalls = /tool calls|Tool calls/i.test(pageContent) || /\d+\s*(tool calls?)/i.test(pageContent)
    const hasTokens = /tokens|Tokens/i.test(pageContent)

    expect(hasTime || hasToolCalls || hasTokens).toBeTruthy()
  })
})
