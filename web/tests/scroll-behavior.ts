/**
 * Scroll Behavior Test Script
 *
 * Run with: npx playwright-cli open http://localhost:5173/scroll-test.html
 * Then: npx playwright-cli run-code "async (page) => { ... }"
 *
 * Or run all tests: npx tsx web/tests/scroll-behavior.ts
 *
 * Tests:
 * 1. Initial load lands at bottom
 * 2. Scroll up stays scrolled up (not yanked back)
 * 3. Scroll back to bottom re-pins
 * 4. Adding items while at bottom auto-scrolls
 * 5. Adding items while scrolled up does NOT auto-scroll
 * 6. Streaming while at bottom auto-scrolls
 * 7. Streaming while scrolled up does NOT auto-scroll
 * 8. Adding sub-agent (tall item) while at bottom auto-scrolls
 */

import { chromium, type Page } from 'playwright'

const URL = process.env.TEST_URL || 'http://localhost:10469'
const THRESHOLD = 75

interface ScrollState {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  dist: number
  atBottom: boolean
}

async function getState(page: Page): Promise<ScrollState> {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement
    return {
      scrollTop: Math.round(scroller.scrollTop),
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      dist: Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight),
      atBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 75
    }
  })
}

async function wait(page: Page, ms: number) {
  await page.waitForTimeout(ms)
}

async function scrollUp(page: Page, px: number) {
  await page.evaluate((px) => {
    const scroller = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement
    scroller.scrollTop = Math.max(0, scroller.scrollTop - px)
  }, px)
}

async function scrollToBottom(page: Page) {
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement
    scroller.scrollTop = scroller.scrollHeight
  })
}

async function addItem(page: Page) {
  await page.fill('textarea', 'test message')
  await page.click('button:has-text("Send")')
}

async function addSubAgent(page: Page) {
  await page.fill('textarea', 'test subagent')
  await page.click('button:has-text("Send")')
}

async function startStreaming(page: Page) {
  await page.fill('textarea', 'streaming test')
  await page.click('button:has-text("Send")')
}

async function stopStreaming(page: Page) {
  await page.waitForTimeout(500)
}

function assert(condition: boolean, msg: string, details?: any) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`, details ?? '')
    throw new Error(`Assertion failed: ${msg}`)
  }
  console.log(`  PASS: ${msg}`)
}

async function runTests() {
  console.log('Launching browser...')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

  await page.goto(URL)
  await wait(page, 1000) // Wait for page to load

  let state: ScrollState
  let passed = 0
  let failed = 0

  // Test 1: Initial load at bottom
  console.log('\nTest 1: Initial load lands at bottom')
  try {
    state = await getState(page)
    assert(state.dist < THRESHOLD, `dist=${state.dist} should be < ${THRESHOLD}`, state)
    passed++
  } catch { failed++ }

  // Test 2: Scroll up stays
  console.log('\nTest 2: Scroll up stays scrolled up')
  try {
    await scrollUp(page, 500)
    await wait(page, 500) // Give time for any snap-back
    state = await getState(page)
    assert(state.dist > THRESHOLD, `dist=${state.dist} should be > ${THRESHOLD} (stayed scrolled up)`, state)
    assert(!state.atBottom, 'atBottom should be false')
    passed++
  } catch { failed++ }

  // Test 3: Scroll back to bottom re-pins
  console.log('\nTest 3: Scroll back to bottom re-pins')
  try {
    await scrollToBottom(page)
    await wait(page, 200)
    state = await getState(page)
    assert(state.dist < THRESHOLD, `dist=${state.dist} should be < ${THRESHOLD}`, state)
    passed++
  } catch { failed++ }

  // Test 4: Adding items while at bottom auto-scrolls
  console.log('\nTest 4: Add items while at bottom → auto-scrolls')
  try {
    // Ensure at bottom
    await scrollToBottom(page)
    await wait(page, 200)
    for (let i = 0; i < 5; i++) {
      await addItem(page)
      await wait(page, 100)
    }
    await wait(page, 300)
    state = await getState(page)
    assert(state.dist < THRESHOLD, `dist=${state.dist} should be < ${THRESHOLD} after adding items`, state)
    passed++
  } catch { failed++ }

  // Test 5: Adding items while scrolled up does NOT auto-scroll
  console.log('\nTest 5: Add items while scrolled up → no auto-scroll')
  try {
    await scrollUp(page, 600)
    await wait(page, 200)
    const beforeState = await getState(page)
    for (let i = 0; i < 3; i++) {
      await addItem(page)
      await wait(page, 100)
    }
    await wait(page, 300)
    state = await getState(page)
    // dist should have INCREASED (more content below) not decreased
    assert(state.dist > beforeState.dist, `dist should grow (was ${beforeState.dist}, now ${state.dist})`, state)
    assert(state.dist > THRESHOLD, `dist=${state.dist} should be > ${THRESHOLD} (stayed scrolled up)`, state)
    passed++
  } catch { failed++ }

  // Reset to bottom for streaming tests
  await scrollToBottom(page)
  await wait(page, 200)

  // Test 6: Streaming while at bottom auto-scrolls
  console.log('\nTest 6: Streaming while at bottom → auto-scrolls')
  try {
    await startStreaming(page)
    await wait(page, 2000) // Stream for 2 seconds
    state = await getState(page)
    await stopStreaming(page)
    assert(state.dist < THRESHOLD, `dist=${state.dist} should be < ${THRESHOLD} during streaming`, state)
    passed++
  } catch {
    await stopStreaming(page)
    failed++
  }

  await wait(page, 300)

  // Test 7: Streaming while scrolled up does NOT auto-scroll
  console.log('\nTest 7: Streaming while scrolled up → no auto-scroll')
  try {
    await scrollUp(page, 600)
    await wait(page, 200)
    const beforeState = await getState(page)
    await startStreaming(page)
    await wait(page, 2000)
    state = await getState(page)
    await stopStreaming(page)
    // Should still be scrolled up (dist should be large)
    assert(state.dist > THRESHOLD, `dist=${state.dist} should be > ${THRESHOLD} (stayed scrolled up during streaming)`, state)
    // scrollTop should be approximately the same (not yanked)
    const drift = Math.abs(state.scrollTop - beforeState.scrollTop)
    assert(drift < 50, `scrollTop drift=${drift} should be < 50 (not yanked)`, { before: beforeState.scrollTop, after: state.scrollTop })
    passed++
  } catch {
    await stopStreaming(page)
    failed++
  }

  // Reset to bottom
  await scrollToBottom(page)
  await wait(page, 200)

  // Test 8: Adding sub-agent (tall item) while at bottom auto-scrolls
  console.log('\nTest 8: Add sub-agent while at bottom → auto-scrolls')
  try {
    await addSubAgent(page)
    await wait(page, 500)
    state = await getState(page)
    assert(state.dist < THRESHOLD, `dist=${state.dist} should be < ${THRESHOLD} after sub-agent`, state)
    passed++
  } catch { failed++ }

  console.log(`\n${'='.repeat(40)}`)
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`)
  console.log(`${'='.repeat(40)}`)

  await browser.close()
  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
