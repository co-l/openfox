import { test, expect } from './fixtures.js'
import type { Message, Session, ToolCall } from '../src/shared/types.js'

const REFERENCE = {
  sessionId: '346f1cb5-c859-44e3-988f-bf71554408bf',
  llmCalls: 311,
  toolCalls: 601,
  toolPreparingEvents: 7_976,
  persistedEvents: 18_474,
  prefillTokens: 23_300_000,
  generatedTokens: 83_000,
  subAgentRuns: 19,
} as const

function createToolCall(index: number): ToolCall {
  return {
    id: `tool-${index}`,
    name: index % 3 === 0 ? 'read_file' : index % 3 === 1 ? 'run_command' : 'search',
    arguments: { path: `/fixture/file-${index % 80}.ts`, query: `reference-${index}` },
    result: {
      success: true,
      output: `Synthetic result ${index}\n${'x'.repeat(600)}`,
    },
  }
}

function createReferenceMessages(): Message[] {
  const messages: Message[] = []
  let messageIndex = 0
  let toolIndex = 0

  for (let run = 0; run < REFERENCE.subAgentRuns; run++) {
    messages.push({
      id: `user-${run}`,
      role: 'user',
      content: `Reference workflow request ${run + 1}`,
      timestamp: new Date(1_700_000_000_000 + messageIndex++).toISOString(),
    })

    const callsInRun = Math.floor(REFERENCE.llmCalls / REFERENCE.subAgentRuns) + (run < REFERENCE.llmCalls % REFERENCE.subAgentRuns ? 1 : 0)
    for (let call = 0; call < callsInRun; call++) {
      const remainingMessages = REFERENCE.llmCalls - (messageIndex - (run + 1))
      const remainingTools = REFERENCE.toolCalls - toolIndex
      const count = Math.max(0, Math.min(2 + (toolIndex < REFERENCE.toolCalls % REFERENCE.llmCalls ? 1 : 0), remainingTools, remainingMessages > 0 ? 3 : remainingTools))
      const toolCalls = Array.from({ length: count }, () => createToolCall(toolIndex++))

      messages.push({
        id: `subagent-${run}-${call}`,
        role: 'assistant',
        content: `Sub-agent ${run + 1} progress ${call + 1}. ${'analysis '.repeat(40)}`,
        timestamp: new Date(1_700_000_000_000 + messageIndex++).toISOString(),
        subAgentId: `reference-run-${run}`,
        subAgentType: run % 2 === 0 ? 'scout' : 'reviewer',
        toolCalls,
        stats: {
          providerId: 'openai-account',
          providerName: 'ChatGPT Plus / Pro',
          backend: 'openai-codex',
          model: 'gpt-5.6-sol',
          mode: 'planner',
          totalTime: 15,
          toolTime: 6,
          prefillTokens: Math.floor(REFERENCE.prefillTokens / REFERENCE.llmCalls),
          prefillSpeed: 486.9,
          generationTokens: Math.floor(REFERENCE.generatedTokens / REFERENCE.llmCalls),
          generationSpeed: 35.6,
        },
      })
    }
  }

  while (toolIndex < REFERENCE.toolCalls) {
    const target = messages.findLast((message) => message.role === 'assistant')
    if (!target) break
    target.toolCalls = [...(target.toolCalls ?? []), createToolCall(toolIndex++)]
  }

  return messages
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0
}

test.describe.configure({ mode: 'serial' })

test('reference-sized session stays responsive while collapsed', async ({ page, projectId, serverUrl }) => {
  test.setTimeout(60_000)

  const createResponse = await fetch(`${serverUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, title: `Performance reference ${REFERENCE.sessionId.slice(0, 8)}` }),
  })
  expect(createResponse.ok).toBeTruthy()
  const created = (await createResponse.json()) as { session: Session }
  const session = {
    ...created.session,
    isRunning: false,
    phase: 'idle',
    metadataEntries: {},
  }
  const messages = createReferenceMessages()

  expect(messages.filter((message) => message.subAgentId)).toHaveLength(REFERENCE.llmCalls)
  expect(messages.flatMap((message) => message.toolCalls ?? [])).toHaveLength(REFERENCE.toolCalls)

  await page.route(`**/api/sessions/${session.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session, messages, contextState: null, queueState: [], pendingQuestions: [] }),
    })
  })

  const loadStart = performance.now()
  await page.goto(`${serverUrl}/p/${projectId}/s/${session.id}`)
  await expect(page.getByText('Sub-agent 19 progress 16.', { exact: false })).toBeVisible({ timeout: 15_000 })
  const loadMs = performance.now() - loadStart

  const collapsedPanels = page.getByRole('button', { name: /expand/i })
  await expect(collapsedPanels).toHaveCount(REFERENCE.subAgentRuns)

  const dom = await page.evaluate(() => ({
    nodes: document.getElementsByTagName('*').length,
    subAgentBodies: document.querySelectorAll('.feed-item article').length,
  }))

  const scrollSamples = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="chat-scroll-container"]')
    if (!scroller) throw new Error('Missing chat scroll container')
    const samples: number[] = []
    for (let index = 0; index < 20; index++) {
      const started = performance.now()
      scroller.scrollTop = index % 2 === 0 ? 0 : scroller.scrollHeight
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      samples.push(performance.now() - started)
    }
    return samples
  })

  const resizeSamples: number[] = []
  for (let index = 0; index < 10; index++) {
    const started = performance.now()
    await page.setViewportSize(index % 2 === 0 ? { width: 1100, height: 720 } : { width: 1450, height: 920 })
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    resizeSamples.push(performance.now() - started)
  }

  const hoverSamples = await page.evaluate(async () => {
    const target = document.querySelector<HTMLElement>('a[href*="/s/"]')
    if (!target) throw new Error('Missing session tab')
    const samples: number[] = []
    for (let index = 0; index < 20; index++) {
      const started = performance.now()
      target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      samples.push(performance.now() - started)
    }
    return samples
  })

  const sidebarToggle = page.getByTitle('Toggle sidebar')
  const clickSamples: number[] = []
  for (let index = 0; index < 6; index++) {
    const started = performance.now()
    await sidebarToggle.click()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    clickSamples.push(performance.now() - started)
  }

  const report = {
    reference: REFERENCE,
    loadMs,
    domNodes: dom.nodes,
    scrollP95Ms: percentile(scrollSamples, 0.95),
    resizeP95Ms: percentile(resizeSamples, 0.95),
    hoverP95Ms: percentile(hoverSamples, 0.95),
    clickP95Ms: percentile(clickSamples, 0.95),
  }
  console.warn(`LONG_SESSION_PERF ${JSON.stringify(report)}`)

  expect(loadMs).toBeLessThan(2_000)
  expect(dom.nodes).toBeLessThan(4_000)
  expect(percentile(scrollSamples, 0.95)).toBeLessThan(80)
  expect(percentile(resizeSamples, 0.95)).toBeLessThan(180)
  expect(percentile(hoverSamples, 0.95)).toBeLessThan(80)
  expect(percentile(clickSamples, 0.95)).toBeLessThan(180)
})
