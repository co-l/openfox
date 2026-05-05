import { test, expect } from './fixtures.js'

test('auto-navigates to new session after clicking sidebar button', async ({ page, projectId, serverUrl }) => {
  await page.goto(`${serverUrl}/p/${projectId}`)

  // Wait for page to load
  await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible({ timeout: 5000 })

  // Click "New Session" in sidebar
  await page.getByTestId('sidebar-new-session-button').click()

  // ASSERTION: URL should navigate to new session
  await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 5000 })

  // ASSERTION: New session should be loaded (check document title attribute)
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 2000 })
})

test('auto-navigates from header dropdown new session', async ({ page, projectId, serverUrl }) => {
  await page.goto(`${serverUrl}/p/${projectId}`)

  // Wait for page to load
  await expect(page.getByTestId('header-session-dropdown')).toBeVisible({ timeout: 5000 })

  // Open session dropdown
  await page.getByTestId('header-session-dropdown').click()

  // Wait for dropdown menu to appear
  await expect(page.getByTestId('session-dropdown-new-session')).toBeVisible({ timeout: 2000 })

  // Click "New session" menu item
  await page.getByTestId('session-dropdown-new-session').click()

  // ASSERTION: URL should navigate
  await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 5000 })

  // ASSERTION: New session should be loaded
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 2000 })
})
