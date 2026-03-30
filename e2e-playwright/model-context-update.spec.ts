import { test, expect } from './fixtures.js'

test('session header updates immediately after editing model context', async ({ page, projectId, serverUrl }) => {
  // Navigate to project
  await page.goto(`${serverUrl}/p/${projectId}`)
  
  // Wait for page to load
  await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible({ timeout: 5000 })
  
  // Create a new session
  await page.getByTestId('sidebar-new-session-button').click()
  await expect(page).toHaveURL(/\/p\/.+\/s\/[a-f0-9-]+$/, { timeout: 5000 })
  
  // Wait for session to load
  await expect(page.locator('html[data-session-title]')).toBeVisible({ timeout: 10000 })
  
  // Wait for context header to appear
  const contextHeader = page.locator('text=Context:').first()
  await expect(contextHeader).toBeVisible({ timeout: 15000 })
  
  // Get initial context
  const contextContainer = contextHeader.locator('..')
  const initialContextText = await contextContainer.textContent()
  console.log('Initial context text:', initialContextText)
  
  // Extract initial maxTokens
  let initialMaxTokens = ''
  const initialMaxTokensMatch = initialContextText?.match(/\/\s*([\d\s]+)/)
  if (initialMaxTokensMatch) {
    initialMaxTokens = initialMaxTokensMatch[1].trim()
    console.log('Initial maxTokens:', initialMaxTokens)
  }
  
  // Open model selector
  const modelSelector = page.locator('button[title="Click to switch provider or model"]')
  await expect(modelSelector).toBeVisible({ timeout: 5000 })
  await modelSelector.click()
  
  // Wait for dropdown to appear
  await page.waitForTimeout(1000)
  
  // Find first model button and click it to select this provider/model for the session
  const firstModelButton = page.locator('button').filter({ hasText: /qwen|glm|minimax/i }).first()
  await expect(firstModelButton).toBeVisible({ timeout: 5000 })
  await firstModelButton.click()
  
  // Wait for dropdown to close and session to update
  await page.waitForTimeout(1000)
  
  // Re-open provider selector to edit the model
  await modelSelector.click()
  await page.waitForTimeout(1000)
  
  // Find edit button for the first model
  const editButton = page.locator('button[title="Edit model context"]').first()
  await expect(editButton).toBeVisible({ timeout: 5000 })
  await editButton.click()
  
  // Wait for modal
  await expect(page.locator('text=Model Properties')).toBeVisible({ timeout: 5000 })
  
  // Change context value
  const contextInput = page.locator('input[type="number"][min="1024"]')
  await expect(contextInput).toBeVisible({ timeout: 5000 })
  const currentValue = await contextInput.inputValue()
  const newValue = parseInt(currentValue) + 100000
  await contextInput.fill(String(newValue))
  
  // Save
  const saveButton = page.locator('button:has-text("Save")')
  await saveButton.click()
  
  // Wait for modal to close
  await expect(page.locator('text=Model Properties')).toBeHidden({ timeout: 5000 })
  await page.waitForTimeout(1000)
  
  // Verify context header updated immediately (without page reload)
  const updatedContextText = await contextContainer.textContent()
  console.log('Updated context text:', updatedContextText)
  
  const updatedMaxTokensMatch = updatedContextText?.match(/\/\s*([\d\s]+)/)
  if (!updatedMaxTokensMatch) {
    throw new Error('Could not extract maxTokens: ' + updatedContextText)
  }
  const updatedMaxTokens = updatedMaxTokensMatch[1].trim()
  console.log('Updated maxTokens:', updatedMaxTokens)
  
  // This assertion verifies the fix: header should update immediately after save
  expect(updatedMaxTokens).not.toBe(initialMaxTokens)
})
