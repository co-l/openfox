import { test, expect } from './fixtures.js'

test('new session inherits defaultModelSelection from config', async ({ page, serverUrl }) => {
  // Navigate to a project
  const response = await fetch(`${serverUrl}/api/projects`)
  const { projects } = await response.json() as { projects: Array<{ id: string }> }
  const projectId = projects[0]?.id
  expect(projectId).toBeDefined()

  await page.goto(`${serverUrl}/p/${projectId}`)
  
  // Wait for page to load
  await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible({ timeout: 10000 })
  
  // Create first session
  await page.getByTestId('sidebar-new-session-button').click()
  await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 5000 })
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 10000 })
  
  // Get initial model from selector
  const modelSelector = page.locator('button[title="Click to switch provider or model"]')
  await expect(modelSelector).toBeVisible({ timeout: 5000 })
  const initialModelText = await modelSelector.textContent()
  console.log('Initial model:', initialModelText)
  
  // Open model selector dropdown
  await modelSelector.click()
  await page.waitForTimeout(1000)
  
  // Select a DIFFERENT model (second one if available)
  const modelButtons = page.locator('button').filter({ hasText: /qwen|glm|minimax/i })
  const modelCount = await modelButtons.count()
  
  let selectedButton
  if (modelCount > 1) {
    selectedButton = modelButtons.nth(1)
  } else {
    selectedButton = modelButtons.first()
  }
  
  await expect(selectedButton).toBeVisible({ timeout: 5000 })
  await selectedButton.click()
  await page.waitForTimeout(500)
  
  // Get the selected model text
  const selectedModelText = await modelSelector.textContent()
  console.log('Selected model:', selectedModelText)
  
  // Verify it's different from initial
  console.log('Initial vs Selected:', initialModelText, 'vs', selectedModelText)
  
  // Create a NEW session - this should inherit the selected model
  await page.getByTestId('sidebar-new-session-button').click()
  await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 5000 })
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 10000 })
  
  // Check the new session's model
  const newSessionModelText = await modelSelector.textContent()
  console.log('New session model:', newSessionModelText)
  
  // FAILING TEST: New session should show the selected model, not the initial default
  expect(newSessionModelText).toBe(selectedModelText)
})

test('model selection persists across page reload', async ({ page, serverUrl }) => {
  // Navigate to a project
  const response = await fetch(`${serverUrl}/api/projects`)
  const { projects } = await response.json() as { projects: Array<{ id: string }> }
  const projectId = projects[0]?.id
  expect(projectId).toBeDefined()

  await page.goto(`${serverUrl}/p/${projectId}`)
  await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible({ timeout: 10000 })
  
  // Create a new session
  await page.getByTestId('sidebar-new-session-button').click()
  await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 5000 })
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 10000 })
  
  // Get model selector
  const modelSelector = page.locator('button[title="Click to switch provider or model"]')
  await expect(modelSelector).toBeVisible({ timeout: 5000 })
  const initialModelText = await modelSelector.textContent()
  console.log('Initial model:', initialModelText)
  
  // Open model selector dropdown
  await modelSelector.click()
  await page.waitForTimeout(1000)
  
  // Select a DIFFERENT model (second one if available)
  const modelButtons = page.locator('button').filter({ hasText: /qwen|glm|minimax/i })
  const modelCount = await modelButtons.count()
  
  let selectedButton
  if (modelCount > 1) {
    selectedButton = modelButtons.nth(1)
  } else {
    selectedButton = modelButtons.first()
  }
  
  await expect(selectedButton).toBeVisible({ timeout: 5000 })
  await selectedButton.click()
  await page.waitForTimeout(500)
  
  // Get the selected model text
  const selectedModelText = await modelSelector.textContent()
  console.log('Selected model:', selectedModelText)
  console.log('Initial vs Selected:', initialModelText, 'vs', selectedModelText)
  
  // Reload the page
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 10000 })
  
  // Check if the model selector still shows the selected model after reload
  const modelSelectorAfterReload = page.locator('button[title="Click to switch provider or model"]')
  const modelTextAfterReload = await modelSelectorAfterReload.textContent()
  console.log('Model after reload:', modelTextAfterReload)
  
  // FAILING TEST: Model selection should persist across page reload
  expect(modelTextAfterReload).toBe(selectedModelText)
})
