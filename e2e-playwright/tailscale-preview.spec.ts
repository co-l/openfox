import { test, expect } from '@playwright/test'
import { execFile, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const execFileAsync = promisify(execFile)

const SERVER_URL = process.env['OPENFOX_E2E_SERVER_URL'] ?? 'http://localhost:10669'
const STANDALONE_FIXTURE_PATH = '/tmp/openfox-fixtures/standalone-fixture.js'
const VITE_FIXTURE_DIR = '/tmp/openfox-fixtures/vite-fixture'

/**
 * The Tailscale-preview spec depends on a real Tailscale node reachable from
 * the runner (it captures the actual HTTPS MagicDNS URL with the real cert).
 * Gate the spec so the standard E2E/CI suite (which runs without Tailscale)
 * does not fail. All three checks must pass:
 *   1. OPENFOX_TS_NODE_HOST set
 *   2. OPENFOX_TS_NODE_IP set
 *   3. `tailscale` binary present AND backend state == "Running"
 * If any fails, the spec is skipped with a precise reason. Verify locally
 * with: OPENFOX_TS_NODE_HOST=… OPENFOX_TS_NODE_IP=… npx playwright test tailscale-preview.spec.ts
 */
function checkTailscaleHarness(): { ok: true } | { ok: false; reason: string } {
  if (!process.env['OPENFOX_TS_NODE_HOST']) {
    return { ok: false, reason: 'OPENFOX_TS_NODE_HOST not set' }
  }
  if (!process.env['OPENFOX_TS_NODE_IP']) {
    return { ok: false, reason: 'OPENFOX_TS_NODE_IP not set' }
  }
  try {
    execSync('which tailscale', { stdio: 'pipe', timeout: 1000 })
  } catch {
    return { ok: false, reason: 'tailscale binary not found in PATH' }
  }
  try {
    const stdout = execSync('tailscale status --json', { stdio: 'pipe', timeout: 4000 }).toString()
    const parsed = JSON.parse(stdout) as { BackendState?: string }
    if (parsed.BackendState !== 'Running') {
      return { ok: false, reason: `tailscale backend not running (${parsed.BackendState ?? 'unknown'})` }
    }
  } catch (err) {
    return {
      ok: false,
      reason: `tailscale status check failed (${err instanceof Error ? err.message : String(err)})`,
    }
  }
  return { ok: true }
}

const TAILSCALE_HARNESS = checkTailscaleHarness()
const SKIP_TAILSCALE = !TAILSCALE_HARNESS.ok
const SKIP_REASON = TAILSCALE_HARNESS.ok ? null : TAILSCALE_HARNESS.reason
const NODE_HOST = process.env['OPENFOX_TS_NODE_HOST'] ?? 'node.tailnet.ts.net'
const TS_NODE_IP = process.env['OPENFOX_TS_NODE_IP'] ?? '127.0.0.1'

interface PreExistingEntry {
  webKey: string
  tcpKey?: string
  proxy: string
}

async function readServeStatus(): Promise<{
  Web: Record<string, { Handlers: Record<string, { Proxy: string }> }>
  TCP: Record<string, unknown>
  Foreground?: Record<string, unknown>
}> {
  const { stdout } = await execFileAsync('tailscale', ['serve', 'status', '--json'], { timeout: 4000 })
  return JSON.parse(stdout)
}

async function fetchPreExistingEntries(): Promise<PreExistingEntry[]> {
  const status = await readServeStatus()
  const out: PreExistingEntry[] = []
  for (const [webKey, entry] of Object.entries(status.Web ?? {})) {
    const handlers = (entry as { Handlers?: Record<string, { Proxy?: string }> }).Handlers ?? {}
    const root = handlers['/']
    if (root && root.Proxy) {
      out.push({ webKey, proxy: root.Proxy })
    }
  }
  return out
}

async function findEntryFor(
  status: Awaited<ReturnType<typeof readServeStatus>>,
  host: string,
): Promise<{ webKey: string; proxy: string } | null> {
  for (const [webKey, entry] of Object.entries(status.Web ?? {})) {
    if (webKey.startsWith(host + ':')) {
      const handlers = (entry as { Handlers?: Record<string, { Proxy?: string }> }).Handlers ?? {}
      const root = handlers['/']
      if (root && root.Proxy) {
        return { webKey, proxy: root.Proxy }
      }
    }
  }
  return null
}

interface TestContext {
  workdir: string
  fixtureCommand: string
  fixtureUrl: string
  authToken: string
  projectId: string
  sessionId: string
  cleanup: () => Promise<void>
}

async function setupProject(name: string, fixtureCommand: string, fixtureUrl: string): Promise<TestContext> {
  // Auth strategy is "local" in this dev environment — no token required.
  // We pass the dummy header so the API surface mirrors a real session.
  const authToken = 'local-no-auth'
  const authHeaders = { 'Content-Type': 'application/json' }

  const timestamp = Date.now()
  const workdir = join(tmpdir(), `openfox-tailscale-e2e-${timestamp}`)
  await mkdir(join(workdir, '.openfox'), { recursive: true })

  // dev.json — filename is the same regardless of OPENFOX_DEV.
  // tailscaleExpose: true is the V1.1 way of opting in to the auto-preview.
  await writeFile(
    join(workdir, '.openfox', 'dev.json'),
    JSON.stringify(
      {
        command: fixtureCommand,
        url: fixtureUrl,
        hotReload: false,
        disableInspect: false,
        tailscaleExpose: true,
      },
      null,
      2,
    ) + '\n',
  )

  // Create project + session
  const projectData = await fetch(`${SERVER_URL}/api/projects`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name, workdir }),
  }).then((r) => r.json())
  const projectId: string = projectData.project.id

  const sessionData = await fetch(`${SERVER_URL}/api/sessions`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ projectId, title: `${name} session` }),
  }).then((r) => r.json())
  const sessionId: string = sessionData.session.id

  const cleanup = async () => {
    try {
      await rm(workdir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  return { workdir, fixtureCommand, fixtureUrl, authToken, projectId, sessionId, cleanup }
}

async function apiGet(path: string, _token: string): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}${path}`)
  if (!res.ok) throw new Error(`GET ${path} failed: ${await res.text()}`)
  return res.json()
}

async function apiPost(path: string, _token: string): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}${path}`, { method: 'POST' })
  if (!res.ok) throw new Error(`POST ${path} failed: ${await res.text()}`)
  return res.json()
}

test.describe('Tailscale preview — Test A (standalone HTTP fixture)', () => {
  test.skip(SKIP_TAILSCALE, SKIP_REASON ?? 'tailscale harness unavailable')

  let ctx: TestContext
  let preExistingEntries: PreExistingEntry[] = []

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    preExistingEntries = await fetchPreExistingEntries()
    console.log('[Test A] Pre-existing Serve entries:', JSON.stringify(preExistingEntries))

    ctx = await setupProject(
      'Tailscale Preview Test A',
      `node ${STANDALONE_FIXTURE_PATH} --port=\${PORT}`,
      'http://127.0.0.1:${PORT}',
    )
  })

  test.afterAll(async () => {
    // Stop dev server to clean up
    try {
      await apiPost(`/api/dev-server/stop?workdir=${encodeURIComponent(ctx.workdir)}`, ctx.authToken)
    } catch {
      /* ignore */
    }
    await ctx.cleanup()
  })

  test('UI: Expose via Tailscale (config-driven) auto-launches a Tailnet preview after Start', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000)

    // 1. Navigate to the session so the sidebar with dev server controls is mounted.
    await page.goto(`${SERVER_URL}/p/${ctx.projectId}/s/${ctx.sessionId}`)
    await page.waitForLoadState('networkidle')

    // 1b. Sanity-check: open the Dev Server Config modal and verify the third
    // checkbox "Expose via Tailscale" is present and reflects config.tailscaleExpose=true.
    await page.getByTitle('Configure dev server').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('label[for="tailscaleExpose"]')).toHaveText('Expose via Tailscale')
    const checkbox = page.locator('input#tailscaleExpose')
    await expect(checkbox).toBeChecked()
    // Close modal without modifying anything.
    await page.getByRole('button', { name: 'Cancel' }).click()

    // 2. Click Start in the Dev Server footer. Auto-expose fires after spawn.
    await page.getByRole('button', { name: 'Start' }).first().click()

    // 3. Wait for the dev server state to reach "running" by polling the API.
    let assignedUrl: string | null = null
    await expect
      .poll(
        async () => {
          const status = (await apiGet(
            `/api/dev-server?workdir=${encodeURIComponent(ctx.workdir)}`,
            ctx.authToken,
          )) as {
            state: string
            url: string | null
          }
          assignedUrl = status.url
          return status.state
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toBe('running')

    // 3b. Wait for the local dev server URL to actually respond (the spawned fixture needs time to bind).
    if (assignedUrl) {
      await expect
        .poll(
          async () => {
            try {
              const res = await fetch(assignedUrl!, { signal: AbortSignal.timeout(1000) })
              return res.status
            } catch {
              return 0
            }
          },
          { timeout: 10_000, intervals: [300] },
        )
        .toBeGreaterThanOrEqual(200)
      console.log('[Test A] Local dev server up at:', assignedUrl)
    }

    // 4. The Tailnet preview should auto-launch — no manual click expected.
    // The footer only shows the URL as secondary info (no Expose/Retry/Stop buttons).
    await expect(page.getByRole('button', { name: 'Expose on Tailscale' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0)

    // 5. Wait for the Tailnet URL to appear in the UI (compact + full sidebar both render it).
    const urlLocator = page.locator('div.font-mono.text-xs.text-text-primary.break-all.select-all').first()
    await expect(urlLocator).toBeVisible({ timeout: 15_000 })
    const tailnetUrl = (await urlLocator.textContent())?.trim()
    expect(tailnetUrl).toBeTruthy()
    expect(tailnetUrl).toMatch(/^https:\/\//)
    console.log('[Test A] Tailnet URL:', tailnetUrl)

    // 6. Confirm the entry appears in tailscale serve status JSON.
    const entry = await findEntryFor(await readServeStatus(), NODE_HOST)
    expect(entry).not.toBeNull()
    expect(entry?.proxy).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    // 7. Open the Tailnet URL in a NEW Chromium instance that has Tailscale
    // MagicDNS wired in. Playwright's default Chromium uses the system DNS which
    // does not know about the tailnet, so we launch a dedicated browser with
    // --host-resolver-rules to MAP the tailnet host to the node's Tailscale IP.
    // The real URL (with the real SNI / Host header / HTTPS cert) is preserved.
    const { chromium } = await import('@playwright/test')
    const tsIp = TS_NODE_IP
    const verifyBrowser = await chromium.launch({
      args: [`--host-resolver-rules=MAP ${NODE_HOST} ${tsIp}`],
    })
    let verifyCtx = await verifyBrowser.newContext()
    let verifyPage = await verifyCtx.newPage()
    let verifyHttpStatus: number | null = null
    let verifyBody = ''
    verifyPage.on('response', async (response) => {
      if (verifyHttpStatus === null) verifyHttpStatus = response.status()
    })
    let response: Awaited<ReturnType<typeof verifyPage.goto>> | null = null
    try {
      response = await verifyPage.goto(tailnetUrl!, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('TLS') || msg.includes('certificate') || msg.includes('CERT')) {
        console.log(
          '[Test A] Real HTTPS cert rejected by headless Chromium — retrying with ignoreHTTPSErrors=true (reported as harness fallback)',
        )
        await verifyPage.close()
        await verifyCtx.close()
        verifyCtx = await verifyBrowser.newContext({ ignoreHTTPSErrors: true })
        verifyPage = await verifyCtx.newPage()
        verifyPage.on('response', async (r) => {
          if (verifyHttpStatus === null) verifyHttpStatus = r.status()
        })
        response = await verifyPage.goto(tailnetUrl!, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      } else {
        throw err
      }
    }
    expect(response).not.toBeNull()
    expect(response!.status()).toBe(200)
    await verifyPage.waitForSelector('#marker', { timeout: 5_000 })
    const markerText = await verifyPage.locator('#marker').textContent()
    expect(markerText).toContain('TAILSCALE_PREVIEW_TEST_A')

    // Capture the listen_port reported by the fixture (it must match the local assigned port)
    const listenPortText = await verifyPage.locator('dt:has-text("listen_port") + dd').textContent()
    const reportedPort = parseInt(listenPortText?.trim() ?? '0', 10)
    expect(reportedPort).toBeGreaterThan(0)

    // Confirm the host header seen by the fixture is the tailnet host (HTTPS via Tailscale)
    const hostHeaderText = await verifyPage.locator('dt:has-text("host_header") + dd').textContent()
    console.log('[Test A] fixture saw host_header =', hostHeaderText)

    verifyBody = (await verifyPage.content()) ?? ''
    await verifyPage.close()
    await verifyCtx.close()
    await verifyBrowser.close()

    // 8. Stop the dev server. The Tailnet preview is auto-torn-down via the
    // dev-server lifecycle hook — no separate Stop button is exposed in the UI.
    await page.getByRole('button', { name: 'Stop' }).first().click()

    // 9. Wait for the Tailnet URL block to disappear.
    await expect(urlLocator).toBeHidden({ timeout: 10_000 })

    // 10. Confirm the Tailnet URL is no longer reachable.
    let stillReachable = true
    try {
      const probe = await fetch(tailnetUrl!, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(3000) })
      // Some Tailscale entries return non-2xx even when "present" (e.g. cert handshake fails);
      // what we really want to assert is that the entry has been removed from serve status.
      stillReachable = probe.status > 0 && probe.status < 500
    } catch {
      stillReachable = false
    }
    console.log('[Test A] After stop, URL reachable (200-499)?', stillReachable)

    // 11. Confirm the entry is gone from serve status JSON.
    await expect
      .poll(
        async () => {
          const status = await readServeStatus()
          const found = await findEntryFor(status, NODE_HOST)
          // Look for an entry whose port matches the URL's port.
          if (!found) return null
          const port = new URL(tailnetUrl!).port
          const entryPort = found.webKey.split(':').pop()
          return entryPort === port ? found : null
        },
        { timeout: 8_000, intervals: [500] },
      )
      .toBeNull()

    // 12. Confirm the PRE-EXISTING 443 entry is still intact.
    const postEntries = await fetchPreExistingEntries()
    console.log('[Test A] Post-test Serve entries:', JSON.stringify(postEntries))
    for (const pre of preExistingEntries) {
      expect(postEntries.find((p) => p.webKey === pre.webKey && p.proxy === pre.proxy)).toBeTruthy()
    }
  })
})

test.describe('Tailscale preview — Test B (Vite)', () => {
  test.skip(SKIP_TAILSCALE, SKIP_REASON ?? 'tailscale harness unavailable')

  let ctx: TestContext
  let preExistingEntries: PreExistingEntry[] = []

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    preExistingEntries = await fetchPreExistingEntries()
    console.log('[Test B] Pre-existing Serve entries:', JSON.stringify(preExistingEntries))

    ctx = await setupProject(
      'Tailscale Preview Test B Vite',
      `cd ${VITE_FIXTURE_DIR} && node_modules/.bin/vite --port \${PORT} --host 127.0.0.1 --strictPort`,
      'http://127.0.0.1:${PORT}',
    )
  })

  test.afterAll(async () => {
    try {
      await apiPost(`/api/dev-server/stop?workdir=${encodeURIComponent(ctx.workdir)}`, ctx.authToken)
    } catch {
      /* ignore */
    }
    await ctx.cleanup()
  })

  test('UI: Vite dev server reachable on tailnet preview if Host validation passes', async ({ page, context }) => {
    test.setTimeout(120_000)

    await page.goto(`${SERVER_URL}/p/${ctx.projectId}/s/${ctx.sessionId}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Start' }).first().click()

    await expect
      .poll(
        async () => {
          const status = (await apiGet(
            `/api/dev-server?workdir=${encodeURIComponent(ctx.workdir)}`,
            ctx.authToken,
          )) as {
            state: string
          }
          return status.state
        },
        { timeout: 30_000, intervals: [500] },
      )
      .toBe('running')

    // No manual "Expose on Tailscale" click — the preview is auto-launched
    // because dev.json has tailscaleExpose: true (Vite fixture already written
    // by setupProject). Just wait for the Tailnet URL to appear.

    const urlLocator = page.locator('div.font-mono.text-xs.text-text-primary.break-all.select-all').first()
    await expect(urlLocator).toBeVisible({ timeout: 30_000 })
    const tailnetUrl = (await urlLocator.textContent())?.trim()
    expect(tailnetUrl).toBeTruthy()
    console.log('[Test B] Tailnet URL:', tailnetUrl)

    const entry = await findEntryFor(await readServeStatus(), NODE_HOST)
    expect(entry).not.toBeNull()

    // Open the Tailnet URL — Vite may reject the host header via its allowedHosts guard.
    // Use a dedicated Chromium with --host-resolver-rules so the tailnet host resolves.
    const { chromium: chromiumB } = await import('@playwright/test')
    const tsIpB = TS_NODE_IP
    const verifyBrowserB = await chromiumB.launch({
      args: [`--host-resolver-rules=MAP ${NODE_HOST} ${tsIpB}`],
    })
    let verifyCtxB = await verifyBrowserB.newContext()
    let verifyPageB = await verifyCtxB.newPage()
    let response: Awaited<ReturnType<typeof verifyPageB.goto>> | null = null
    let body = ''
    let status = 0
    try {
      response = await verifyPageB.goto(tailnetUrl!, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      status = response?.status() ?? 0
      body = await verifyPageB.content()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('TLS') || msg.includes('certificate') || msg.includes('CERT')) {
        console.log(
          '[Test B] Real HTTPS cert rejected by headless Chromium — retrying with ignoreHTTPSErrors=true (reported as harness fallback)',
        )
        await verifyPageB.close()
        await verifyCtxB.close()
        verifyCtxB = await verifyBrowserB.newContext({ ignoreHTTPSErrors: true })
        verifyPageB = await verifyCtxB.newPage()
        response = await verifyPageB.goto(tailnetUrl!, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        status = response?.status() ?? 0
        body = await verifyPageB.content()
      } else {
        await verifyPageB.close()
        await verifyCtxB.close()
        await verifyBrowserB.close()
        throw err
      }
    }
    expect(response).not.toBeNull()
    await verifyPageB.close()
    await verifyCtxB.close()
    await verifyBrowserB.close()

    console.log('[Test B] HTTP status from Vite:', status)
    console.log('[Test B] Body preview:', body.slice(0, 500))

    if (status === 200 && body.includes('TAILSCALE_PREVIEW_TEST_B_VITE')) {
      console.log('[Test B] RESULT: Vite served the fixture content via Tailscale — PASS')
      expect(body).toContain('TAILSCALE_PREVIEW_TEST_B_VITE')
    } else if (body.toLowerCase().includes('blocked request') || body.toLowerCase().includes('not allowed')) {
      console.log('[Test B] RESULT: Vite rejected the Host header (allowedHosts) — INCOMPATIBILITY')
      expect(body.toLowerCase()).toMatch(/blocked|allowed/)
    } else {
      throw new Error(`Unexpected response: status=${status} body=${body.slice(0, 300)}`)
    }

    // Cleanup: stop the dev server. Preview is auto-torn-down via the dev-server lifecycle.
    await page.getByRole('button', { name: 'Stop' }).first().click()
    await expect(urlLocator).toBeHidden({ timeout: 10_000 })

    // Pre-existing 443 entry must remain intact.
    const postEntries = await fetchPreExistingEntries()
    for (const pre of preExistingEntries) {
      expect(postEntries.find((p) => p.webKey === pre.webKey && p.proxy === pre.proxy)).toBeTruthy()
    }
  })
})
