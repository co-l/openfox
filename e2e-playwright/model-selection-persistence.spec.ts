import { test, expect } from './fixtures.js'

test('new session inherits defaultModelSelection from config', async ({ page, serverUrl }) => {
  // Get initial config
  const initialConfigResponse = await fetch(`${serverUrl}/api/config`)
  const initialConfig = await initialConfigResponse.json() as {
    model: string
    defaultModelSelection: string | null
  }
  console.log('Initial config:', { model: initialConfig.model, defaultModelSelection: initialConfig.defaultModelSelection })
  
  // Navigate to a project
  const response = await fetch(`${serverUrl}/api/projects`)
  const { projects } = await response.json() as { projects: Array<{ id: string }> }
  const projectId = projects[0]?.id
  expect(projectId).toBeDefined()

  await page.goto(`${serverUrl}/p/${projectId}`)
  
  // Wait for page to load
  await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible({ timeout: 10000 })
  
  // Create a new session
  await page.getByTestId('sidebar-new-session-button').click()
  await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 5000 })
  
  // Wait for session to load
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 10000 })
  
  // Get initial model from selector
  const modelSelector = page.locator('button[title="Click to switch provider or model"]')
  await expect(modelSelector).toBeVisible({ timeout: 5000 })
  const initialModelText = await modelSelector.textContent()
  console.log('Initial model:', initialModelText)
  
  // Open model selector dropdown
  await modelSelector.click()
  await page.waitForTimeout(1000)
  
  // Find first model button and click it to select this provider/model for the session
  const firstModelButton = page.locator('button').filter({ hasText: /qwen|glm|minimax/i }).first()
  await expect(firstModelButton).toBeVisible({ timeout: 5000 })
  await firstModelButton.click()
  
  await page.waitForTimeout(500)
  
  // Get the selected model text
  const selectedModelText = await modelSelector.textContent()
  console.log('Selected model:', selectedModelText)
  
  // Check that config was updated with defaultModelSelection
  const configAfterSelectionResponse = await fetch(`${serverUrl}/api/config`)
  const configAfterSelection = await configAfterSelectionResponse.json() as {
    model: string
    defaultModelSelection: string | null
  }
  console.log('Config after selection:', { model: configAfterSelection.model, defaultModelSelection: configAfterSelection.defaultModelSelection })
  
  // Create another new session - this should inherit the defaultModelSelection
  await page.getByTestId('sidebar-new-session-button').click()
  await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 5000 })
  
  // Wait for session to load
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 10000 })
  
  // Check the session's provider/model via API
  const sessionId = page.url().split('/s/')[1]
  const sessionResponse = await fetch(`${serverUrl}/api/sessions/${sessionId}`)
  const sessionData = await sessionResponse.json() as {
    session: { providerId: string | null; providerModel: string | null }
  }
  console.log('New session provider/model:', sessionData.session.providerId, sessionData.session.providerModel)
  
  // Check if the model selector still shows the selected model
  const newSessionModelText = await modelSelector.textContent()
  console.log('New session model:', newSessionModelText)
  
  // This should pass but currently fails - new sessions don't inherit defaultModelSelection
  expect(newSessionModelText).toBe(selectedModelText)
})

test('model selection persists across page reload', async ({ page, serverUrl }) => {
  // Navigate to a project
  const response = await fetch(`${serverUrl}/api/projects`)
  const { projects } = await response.json() as { projects: Array<{ id: string }> }
  const projectId = projects[0]?.id
  expect(projectId).toBeDefined()

  await page.goto(`${serverUrl}/p/${projectId}`)
  
  // Wait for page to load
  await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible({ timeout: 10000 })
  
  // Create a new session
  await page.getByTestId('sidebar-new-session-button').click()
  await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 5000 })
  
  // Wait for session to load
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 10000 })
  
  // Get initial model from selector
  const modelSelector = page.locator('button[title="Click to switch provider or model"]')
  await expect(modelSelector).toBeVisible({ timeout: 5000 })
  
  // Open model selector dropdown
  await modelSelector.click()
  await page.waitForTimeout(1000)
  
  // Select a model
  const firstModelButton = page.locator('button').filter({ hasText: /qwen|glm|minimax/i }).first()
  await expect(firstModelButton).toBeVisible({ timeout: 5000 })
  await firstModelButton.click()
  
  await page.waitForTimeout(500)
  
  // Get the selected model text
  const selectedModelText = await modelSelector.textContent()
  console.log('Selected model:', selectedModelText)
  
  // Reload the page to verify model selection persists
  await page.reload({ waitUntil: 'networkidle' })
  
  // Wait for session to load again
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 10000 })
  
  // Check if the model selector still shows the selected model
  const modelSelectorAfterReload = page.locator('button[title="Click to switch provider or model"]')
  const modelTextAfterReload = await modelSelectorAfterReload.textContent()
  console.log('Model after reload:', modelTextAfterReload)
  
  // This should pass - model selection persists across page reload
  expect(modelTextAfterReload).toBe(selectedModelText)
})
