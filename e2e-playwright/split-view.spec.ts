import { test, expect } from './fixtures.js'

// These tests share a single project and mutate session state, so they must
// not run concurrently with each other against the same server.
test.describe.configure({ mode: 'serial' })

async function createSession(serverUrl: string, projectId: string, title: string): Promise<string> {
  const res = await fetch(`${serverUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, title }),
  })
  if (!res.ok) throw new Error(`Failed to create session: ${await res.text()}`)
  const data = (await res.json()) as { session: { id: string } }
  return data.session.id
}

test('opens the split view from the homepage and manages panes', async ({ page, projectId, serverUrl }) => {
  const [a, b, c] = await Promise.all([
    createSession(serverUrl, projectId, 'Split pane A'),
    createSession(serverUrl, projectId, 'Split pane B'),
    createSession(serverUrl, projectId, 'Split pane C'),
  ])

  await page.goto(`${serverUrl}/`)
  await expect(page.locator('a[href="/split-view"]')).toBeVisible({ timeout: 10000 })

  // Enter split view from the homepage entry point
  await page.locator('a[href="/split-view"]').click()
  await expect(page).toHaveURL(/\/split-view$/, { timeout: 5000 })

  // Fresh visit: no panes yet, empty state shown, sessions listed on the left
  await expect(page.getByText(/pick a session on the left/)).toBeVisible({ timeout: 5000 })
  await expect(page.locator(`[data-session-item="${a}"]`)).toBeVisible()

  // Click sessions to add them as panes
  await page.locator(`[data-session-item="${a}"]`).click()
  await expect(page.locator(`[data-split-pane="${a}"]`)).toBeVisible({ timeout: 5000 })
  await page.locator(`[data-session-item="${b}"]`).click()
  await expect(page.locator(`[data-split-pane="${b}"]`)).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-split-pane]')).toHaveCount(2)

  // Control panel tracks the open panes
  await expect(page.locator('[data-open-pane]')).toHaveCount(2)

  // Each pane has its own criteria sidebar toggle (independent per-pane state).
  // Narrow panes start closed ("like on mobile") so the chat input stays usable.
  await expect(page.getByRole('button', { name: 'Show criteria sidebar' })).toHaveCount(2)
  await page.locator(`[data-split-pane="${a}"]`).getByRole('button', { name: 'Show criteria sidebar' }).click()
  await expect(
    page.locator(`[data-split-pane="${a}"]`).getByRole('button', { name: 'Hide criteria sidebar' }),
  ).toBeVisible()
  await expect(
    page.locator(`[data-split-pane="${b}"]`).getByRole('button', { name: 'Show criteria sidebar' }),
  ).toBeVisible()

  // Close pane B — split view survives with the remaining pane
  await page.locator(`[data-split-pane="${b}"]`).getByRole('button', { name: 'Close pane' }).click()
  await expect(page.locator('[data-split-pane]')).toHaveCount(1)
  await expect(page).toHaveURL(/\/split-view$/)

  // Reload: the open layout is restored from persistence
  await page.reload()
  await expect(page.locator(`[data-split-pane="${a}"]`)).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-split-pane]')).toHaveCount(1)

  // Open a third session from the left column and confirm both render
  await page.locator(`[data-session-item="${c}"]`).click()
  await expect(page.locator(`[data-split-pane="${c}"]`)).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-split-pane]')).toHaveCount(2)
})

test('streams a message into only its own pane', async ({ page, projectId, serverUrl }) => {
  const [a, b] = await Promise.all([
    createSession(serverUrl, projectId, 'Stream pane A'),
    createSession(serverUrl, projectId, 'Stream pane B'),
  ])
  const marker = 'streaming marker alpha'

  await page.goto(`${serverUrl}/`)
  await page.locator('a[href="/split-view"]').click()
  await expect(page).toHaveURL(/\/split-view$/, { timeout: 5000 })
  await page.locator(`[data-session-item="${a}"]`).click()
  await expect(page.locator(`[data-split-pane="${a}"]`)).toBeVisible({ timeout: 5000 })
  await page.locator(`[data-session-item="${b}"]`).click()
  await expect(page.locator(`[data-split-pane="${b}"]`)).toBeVisible({ timeout: 5000 })

  const paneA = page.locator(`[data-split-pane="${a}"]`)
  const paneB = page.locator(`[data-split-pane="${b}"]`)

  // Send a message from pane A's own chat input (mock LLM replies deterministically)
  await paneA.getByTestId('chat-input-textarea').fill(marker)
  await paneA.getByTestId('chat-send-button').click()

  // The user message lands in pane A immediately…
  await expect(paneA.getByText(marker)).toBeVisible({ timeout: 5000 })
  // …and the streamed assistant reply arrives there too.
  await expect(paneA.getByText('I understand. Let me help you with that.')).toBeVisible({ timeout: 30000 })

  // Pane B is untouched: neither the user message nor the reply crossed over.
  await expect(paneB.getByText(marker)).toHaveCount(0)
  await expect(paneB.getByText('I understand. Let me help you with that.')).toHaveCount(0)
})

test('supports unlimited panes, layout switching and a collapsible control column', async ({
  page,
  projectId,
  serverUrl,
}) => {
  const ids = await Promise.all(
    ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((name) =>
      createSession(serverUrl, projectId, `Unlimited ${name}`),
    ),
  )

  await page.goto(`${serverUrl}/`)
  await page.locator('a[href="/split-view"]').click()
  await expect(page).toHaveURL(/\/split-view$/, { timeout: 5000 })

  // No cap: all five sessions open as panes at once (default columns layout)
  for (const id of ids) {
    await page.locator(`[data-session-item="${id}"]`).click()
  }
  await expect(page.locator('[data-split-pane]')).toHaveCount(5, { timeout: 10000 })
  await expect(page.locator('[data-open-pane]')).toHaveCount(5)

  // Switch to grid and back to columns — every pane stays rendered
  await page.getByRole('button', { name: 'Grid layout' }).click()
  await expect(page.getByRole('button', { name: 'Grid layout' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-split-pane]')).toHaveCount(5)
  await page.getByRole('button', { name: 'Columns layout' }).click()
  await expect(page.getByRole('button', { name: 'Columns layout' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-split-pane]')).toHaveCount(5)

  // Header toggle collapses the control column, then restores it
  await page.getByRole('button', { name: 'Toggle split view control panel' }).click()
  await expect(page.getByTestId('split-control-panel')).toHaveClass(/w-0/, { timeout: 3000 })
  await page.getByRole('button', { name: 'Toggle split view control panel' }).click()
  await expect(page.getByTestId('split-control-panel')).not.toHaveClass(/w-0/, { timeout: 3000 })
})
