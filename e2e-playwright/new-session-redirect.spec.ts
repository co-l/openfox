import { test, expect } from './fixtures.js'

test('direct hit to /new redirects to new session', async ({ page, projectId, serverUrl }) => {
  await page.goto(`${serverUrl}/p/${projectId}/new`)
  await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 10000 })
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 5000 })
})

test('repeated direct hits to /new each redirect correctly', async ({ page, projectId, serverUrl }) => {
  const seenUrls: string[] = []

  for (let i = 0; i < 5; i++) {
    await page.goto(`${serverUrl}/p/${projectId}/new`)
    await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 10000 })
    await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 5000 })

    const url = page.url()
    expect(seenUrls).not.toContain(url)
    seenUrls.push(url)
  }
})
