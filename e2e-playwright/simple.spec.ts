import { test, expect } from './fixtures.js'

test('simple test', async ({ page, projectId, serverUrl }) => {
  await page.goto(`${serverUrl}/p/${projectId}`)
  await expect(page).toHaveTitle(/OpenFox/)
})
