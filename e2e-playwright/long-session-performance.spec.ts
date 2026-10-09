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

// Display items the synthetic reference expands into: one user message + one
// sub-agent group per run.
const REFERENCE_DISPLAY_ITEMS = REFERENCE.subAgentRuns * 2

function createToolCall(index: number): ToolCall {
  return {
    id: `tool-${index}`,
    name: index % 3 === 0 ? 'read_file' : index % 3 === 1 ? 'run_command' : 'search',
    arguments: { path: `/fixture/file-${index % 80}.ts`, query: `reference-${index}` },
    result: {
      success: true,
      output: `Synthetic result ${index}\n${'x'.repeat(600)}`,
      durationMs: 120,
      truncated: false,
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

    const callsInRun =
      Math.floor(REFERENCE.llmCalls / REFERENCE.subAgentRuns) +
      (run < REFERENCE.llmCalls % REFERENCE.subAgentRuns ? 1 : 0)
    for (let call = 0; call < callsInRun; call++) {
      const remainingMessages = REFERENCE.llmCalls - (messageIndex - (run + 1))
      const remainingTools = REFERENCE.toolCalls - toolIndex
      const count = Math.max(
        0,
        Math.min(
          2 + (toolIndex < REFERENCE.toolCalls % REFERENCE.llmCalls ? 1 : 0),
          remainingTools,
          remainingMessages > 0 ? 3 : remainingTools,
        ),
      )
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
          backend: 'ollama',
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

// Main-thread freeze instrumentation, installed before any app code runs.
//
// - PerformanceObserver('longtask'): the W3C definition of a freeze (a task
//   blocking the main thread for > 50ms), with timestamps so the timeline
//   below can be correlated with network activity.
// - rAF gap sampler: requestAnimationFrame callbacks are skipped while the
//   main thread is busy, so the gap between consecutive callbacks measures
//   perceived freeze time even for work the longtask API attributes elsewhere.
//   Caveat (headless Chromium): BeginFrames are only delivered when the
//   compositor has damage to draw, so a settled page can starve rAF
//   independently of main-thread work — a gap starting at document start (see
//   rafGapMaxAtMs) is compositor startup, not an app freeze. The longtask
//   metric stays the authoritative app-freeze measure; the sample phases
//   below therefore settle on task-queue timers, not rAF.
// - fetch/WS timeline: which network exchange was in flight when a longtask
//   ran (the classic "session history load" freeze starts when the big
//   /api/sessions/:id payload lands).
const PERF_HARNESS = `
(() => {
  const w = window
  w.__longtasks = []
  w.__rafGaps = []
  w.__net = []
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__longtasks.push({ t: Math.round(entry.startTime), d: Math.round(entry.duration) })
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    // longtask observer unsupported (Safari): rAF gaps still measure freezes
  }
  let last = performance.now()
  const tick = () => {
    const now = performance.now()
    const gap = now - last
    if (gap > 50) w.__rafGaps.push({ t: Math.round(last), g: Math.round(gap) })
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  const origFetch = w.fetch
  w.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input)
    w.__net.push({ k: 'f0', t: Math.round(performance.now()), u: url })
    return origFetch.apply(this, arguments).then((res) => {
      w.__net.push({ k: 'f1', t: Math.round(performance.now()), u: url, s: res.status })
      return res
    })
  }

  const OrigWebSocket = w.WebSocket
  class TrackedWebSocket extends OrigWebSocket {
    constructor(url, protocols) {
      super(url, protocols)
      const u = String(url)
      w.__net.push({ k: 'w0', t: Math.round(performance.now()), u })
      this.addEventListener('message', () => w.__net.push({ k: 'w1', t: Math.round(performance.now()) }))
      this.addEventListener('close', () => w.__net.push({ k: 'w2', t: Math.round(performance.now()) }))
    }
  }
  for (const name of Object.getOwnPropertyNames(OrigWebSocket)) {
    if (!(name in TrackedWebSocket)) TrackedWebSocket[name] = OrigWebSocket[name]
  }
  w.WebSocket = TrackedWebSocket
})()
`

interface PerfMetrics {
  longtaskCount: number
  longtaskMaxMs: number
  longtaskTotalMs: number
  rafGapMaxMs: number
  rafGapP95Ms: number
  rafGapMaxAtMs: number
  net: Array<{ k: string; t: number; u?: string; s?: number }>
}

/** Phase marker in page time, so the reported longtask/rAF-gap timeline can be
 * attributed to the test phase it fell in. */
async function mark(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.evaluate((m) => {
    const w = window as unknown as { __marks?: Array<{ t: number; m: string }> }
    w.__marks ??= []
    w.__marks.push({ t: Math.round(performance.now()), m })
  }, name)
}

async function installPerfHarness(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(PERF_HARNESS)
}

async function collectPerf(page: import('@playwright/test').Page): Promise<PerfMetrics> {
  return page.evaluate((quantile) => {
    const longtasks = (window as unknown as { __longtasks: Array<{ t: number; d: number }> }).__longtasks ?? []
    const rafGaps = (window as unknown as { __rafGaps: Array<{ t: number; g: number }> }).__rafGaps ?? []
    const net = (window as unknown as { __net: Array<{ k: string; t: number; u?: string; s?: number }> }).__net ?? []
    const gaps = rafGaps.map((entry) => entry.g)
    const p95 = gaps.length
      ? ([...gaps].sort((a, b) => a - b)[Math.min(gaps.length - 1, Math.ceil(gaps.length * quantile) - 1)] ?? 0)
      : 0
    let maxIndex = 0
    for (let index = 1; index < rafGaps.length; index++) {
      if (rafGaps[index].g > rafGaps[maxIndex].g) maxIndex = index
    }
    return {
      longtaskCount: longtasks.length,
      longtaskMaxMs: longtasks.reduce((max, entry) => Math.max(max, entry.d), 0),
      longtaskTotalMs: longtasks.reduce((sum, entry) => sum + entry.d, 0),
      rafGapMaxMs: rafGaps.length ? rafGaps[maxIndex].g : 0,
      rafGapP95Ms: p95,
      rafGapMaxAtMs: rafGaps.length ? rafGaps[maxIndex].t : -1,
      net,
    }
  }, 0.95)
}

// The feed container is the ScrollArea host; with OverlayScrollbars the
// element that actually scrolls is the viewport inside it (v2 marks it with
// data-overlayscrollbars-viewport), with native scrollbars the host itself.
// Inlined as strings: page.evaluate bodies must be self-contained in this
// runner (no function arguments, no module-scope references).
const FEED_SCROLLER = `
  const container = document.querySelector('[data-testid="chat-scroll-container"]')
  if (!container) return null
  return container.querySelector('[data-overlayscrollbars-viewport]') || container
`
const MOUNTED_ITEMS = `document.querySelectorAll('[data-item-index]:not([data-placeholder])').length`

// Two 16ms task-queue rounds (≈ two frames in wall time). Headless Chromium
// delivers BeginFrames only when the compositor has damage to draw, so rAF
// can starve indefinitely on a settled page (see the harness caveat above)
// and rAF-based waits would hang — or silently inflate a sample by however
// long the starvation lasted. Task-queue timers fire the moment the main
// thread is free, so this settles on main-thread quiescence, which is what
// the samples measure; the longtask observer keeps covering real freezes.
const SETTLE2_SRC = `new Promise((resolve) => {
  let n = 0
  const step = () => {
    if (++n >= 2) {
      resolve()
      return
    }
    setTimeout(step, 16)
  }
  setTimeout(step, 16)
})`
const SETTLE1_SRC = `new Promise((resolve) => setTimeout(resolve, 16))`

async function scrollFeedToTop(page: import('@playwright/test').Page, expectedItems: number): Promise<void> {
  await page.evaluate(
    async (args: { expected: number; scrollerSrc: string; mountedSrc: string; settleSrc: string }) => {
      const scroller = new Function(args.scrollerSrc)() as HTMLElement | null
      if (!scroller) throw new Error('Missing chat scroll container')
      let lastMounted = -1
      let stagnant = 0
      for (let attempt = 0; attempt < 40; attempt++) {
        scroller.scrollTop = 0
        await new Function(`return (${args.settleSrc})`)()
        const mounted = new Function(`return (${args.mountedSrc})`)() as number
        if (mounted >= args.expected) break
        // Stop early when the window stops growing (the implementation under
        // test may not reveal everything; the sample below still measures it).
        stagnant = mounted === lastMounted ? stagnant + 1 : 0
        lastMounted = mounted
        if (stagnant >= 6) break
      }
    },
    { expected: expectedItems, scrollerSrc: FEED_SCROLLER, mountedSrc: MOUNTED_ITEMS, settleSrc: SETTLE2_SRC },
  )
}

// Mirror the reporter's actual display settings (native scrollbars, feed
// windowing) so pre- and post-fix runs exercise the same code paths.
async function applyDisplaySettings(serverUrl: string): Promise<void> {
  const settings: Record<string, string> = {
    'display.useNativeScrollbars': 'true',
    'display.useNativeScrollbarsCodeBlocks': 'true',
    'display.feedVirtualization': 'true',
    'display.maxVisibleItems': '100',
  }
  for (const [key, value] of Object.entries(settings)) {
    const res = await fetch(`${serverUrl}/api/settings/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    if (!res.ok) throw new Error(`Failed to set ${key}: ${res.status}`)
  }
}

// Resolves the element that actually scrolls the readonly feed. Post-fix
// views carry a chat-scroll-container testid on the ScrollArea host: with
// OverlayScrollbars the inner data-overlayscrollbars-viewport element scrolls,
// with native scrollbars the host itself. Pre-fix views have neither, so the
// fallback climbs from the first mounted item to its scrollable ancestor.
// Inlined (as a string) into the page.evaluate calls below: Playwright cannot
// serialize function arguments in this runner, and the string avoids TS
// overload noise.
const RESOLVE_RO_SCROLLER = `
  const byTestId = document.querySelector('[data-testid="chat-scroll-container"]')
  if (byTestId) return (byTestId.querySelector('[data-overlayscrollbars-viewport]') || byTestId)
  const first = document.querySelector('[data-item-index]')
  if (!first) throw new Error('No feed items mounted')
  let el = first
  while (el && el !== document.body) {
    if (el.hasAttribute('data-overlayscrollbars-viewport') || el.classList.contains('overflow-y-auto')) return el
    el = el.parentElement
  }
  throw new Error('No scrollable feed container found')
`

test.describe.configure({ mode: 'serial' })

test('reference-sized session stays responsive while collapsed', async ({ page, projectId, serverUrl }) => {
  // Generous: on a broken build the main thread can block for minutes, and
  // the point is to measure that, not to time out before reporting it.
  test.setTimeout(180_000)

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

  await applyDisplaySettings(serverUrl)
  await installPerfHarness(page)
  await page.route(`**/api/sessions/${session.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session, messages, contextState: null, queueState: [], pendingQuestions: [] }),
    })
  })

  const loadStart = performance.now()
  await page.goto(`${serverUrl}/p/${projectId}/s/${session.id}`)
  // The last user message sits inside the initial bottom-anchored window, and
  // (unlike sub-agent message text) it renders whether or not sub-agent
  // bodies are lazily mounted.
  await expect(page.getByText('Reference workflow request 19', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  })
  const loadMs = performance.now() - loadStart

  // The initial window only mounts the most recent items; scroll to the top
  // to reveal and mount as many groups as the implementation allows.
  await mark(page, 'scroll-to-top:begin')
  await scrollFeedToTop(page, REFERENCE_DISPLAY_ITEMS)
  await mark(page, 'scroll-to-top:end')
  const mountedItems = await page.evaluate(
    (mountedSrc: string) => new Function(`return (${mountedSrc})`)(),
    MOUNTED_ITEMS,
  )
  const expandButtons = await page.evaluate(
    () => [...document.querySelectorAll('button')].filter((b) => /expand/i.test(b.textContent ?? '')).length,
  )

  const dom = await page.evaluate(() => ({
    nodes: document.getElementsByTagName('*').length,
    subAgentBodies: document.querySelectorAll('.feed-item article').length,
  }))

  await mark(page, 'scroll-samples:begin')
  const scrollSamples = await page.evaluate(
    async (args: { scrollerSrc: string; settleSrc: string }) => {
      const scroller = new Function(args.scrollerSrc)() as HTMLElement | null
      if (!scroller) throw new Error('Missing chat scroll container')
      const samples: number[] = []
      for (let index = 0; index < 20; index++) {
        const started = performance.now()
        scroller.scrollTop = index % 2 === 0 ? 0 : scroller.scrollHeight
        await new Function(`return (${args.settleSrc})`)()
        samples.push(performance.now() - started)
      }
      return samples
    },
    { scrollerSrc: FEED_SCROLLER, settleSrc: SETTLE2_SRC },
  )
  await mark(page, 'scroll-samples:end')

  await mark(page, 'resize-samples:begin')
  const resizeSamples: number[] = []
  for (let index = 0; index < 10; index++) {
    const started = performance.now()
    await page.setViewportSize(index % 2 === 0 ? { width: 1100, height: 720 } : { width: 1450, height: 920 })
    await page.evaluate((settleSrc: string) => new Function(`return (${settleSrc})`)(), SETTLE2_SRC)
    resizeSamples.push(performance.now() - started)
  }
  await mark(page, 'resize-samples:end')

  await mark(page, 'hover-samples:begin')
  const hoverSamples = await page.evaluate(async (settleSrc: string) => {
    const target = document.querySelector<HTMLElement>('a[href*="/s/"]')
    if (!target) return []
    const samples: number[] = []
    for (let index = 0; index < 20; index++) {
      const started = performance.now()
      target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await new Function(`return (${settleSrc})`)()
      samples.push(performance.now() - started)
    }
    return samples
  }, SETTLE1_SRC)
  await mark(page, 'hover-samples:end')

  // A 1px scroll pulse wakes the headless compositor (scroll damage is the
  // proven way to get BeginFrames delivered) before the click phase, so the
  // actionability checks that internally use rAF cannot stall on a starved
  // compositor.
  await page.evaluate(
    (args: { scrollerSrc: string; settleSrc: string }) =>
      new Promise<void>((resolve) => {
        const scroller = new Function(args.scrollerSrc)() as HTMLElement | null
        if (!scroller) {
          resolve()
          return
        }
        scroller.scrollTop = 1
        new Function(`return (${args.settleSrc})`)().then(() => {
          scroller.scrollTop = 0
          new Function(`return (${args.settleSrc})`)().then(resolve)
        })
      }),
    { scrollerSrc: FEED_SCROLLER, settleSrc: SETTLE2_SRC },
  )

  await mark(page, 'click-samples:begin')
  const sidebarToggle = page.getByTitle('Toggle session list')
  const clickSamples: number[] = []
  for (let index = 0; index < 3; index++) {
    const started = performance.now()
    try {
      await sidebarToggle.click({ timeout: 8_000 })
    } catch {
      // The main thread was blocked beyond the action timeout — the stall
      // itself is the measurement.
      clickSamples.push(performance.now() - started)
      continue
    }
    await page.evaluate((settleSrc: string) => new Function(`return (${settleSrc})`)(), SETTLE2_SRC)
    clickSamples.push(performance.now() - started)
  }
  await mark(page, 'click-samples:end')

  const perf = await collectPerf(page)

  const report = {
    case: 'live',
    reference: REFERENCE,
    loadMs: Math.round(loadMs),
    mountedItems,
    expandButtons,
    domNodes: dom.nodes,
    subAgentBodies: dom.subAgentBodies,
    longtaskCount: perf.longtaskCount,
    longtaskMaxMs: perf.longtaskMaxMs,
    longtaskTotalMs: perf.longtaskTotalMs,
    rafGapMaxMs: perf.rafGapMaxMs,
    rafGapMaxAtMs: perf.rafGapMaxAtMs,
    rafGapP95Ms: perf.rafGapP95Ms,
    scrollP95Ms: Math.round(percentile(scrollSamples, 0.95)),
    resizeP95Ms: Math.round(percentile(resizeSamples, 0.95)),
    hoverP95Ms: Math.round(percentile(hoverSamples, 0.95)),
    clickP95Ms: Math.round(percentile(clickSamples, 0.95)),
    marks: await page.evaluate(
      () => (window as unknown as { __marks?: Array<{ t: number; m: string }> }).__marks ?? [],
    ),
    net: perf.net,
  }
  console.warn(`LONG_SESSION_PERF ${JSON.stringify(report)}`)

  // The window must be able to reveal every group of the reference session.
  await expect(page.getByRole('button', { name: /expand/i })).toHaveCount(REFERENCE.subAgentRuns, { timeout: 10_000 })

  // Load time here is dominated by the dev environment, not the app: the Vite
  // module graph (~200 requests) plus the server's cold first-request latency
  // (the second /api/config + model refresh runs 0.5-0.6s on a fresh server).
  // Observed post-fix range is 1.1-2.6s (spiky with machine load); the pre-fix
  // baseline was 3.6s. The longtask budget below is the real freeze gate.
  expect(loadMs).toBeLessThan(3_000)
  expect(dom.nodes).toBeLessThan(25_000)
  expect(perf.longtaskMaxMs).toBeLessThanOrEqual(500)
  expect(percentile(scrollSamples, 0.95)).toBeLessThan(80)
  expect(percentile(resizeSamples, 0.95)).toBeLessThan(180)
  expect(percentile(hoverSamples, 0.95)).toBeLessThan(80)
  expect(percentile(clickSamples, 0.95)).toBeLessThan(180)
})

test('readonly view of a reference-sized session stays bounded', async ({ page, projectId, serverUrl }) => {
  test.setTimeout(180_000)

  const createResponse = await fetch(`${serverUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, title: `Performance readonly ${REFERENCE.sessionId.slice(0, 8)}` }),
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

  await applyDisplaySettings(serverUrl)
  await installPerfHarness(page)
  await page.route(
    (url) => url.pathname === `/api/sessions/${session.id}` && url.search === '?full=true',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session, messages, hiddenCount: 0 }),
      })
    },
  )

  const loadStart = performance.now()
  await page.goto(`${serverUrl}/p/${projectId}/s/${session.id}/readonly`)
  // Top-anchored windowing opens at the beginning of the history; the first
  // user message is the topmost of the (substring-matching) set in DOM order.
  await expect(page.getByText('Reference workflow request 1').first()).toBeVisible({ timeout: 30_000 })
  const loadMs = performance.now() - loadStart

  const domInitial = await page.evaluate(
    (mountedSrc: string) => ({
      nodes: document.getElementsByTagName('*').length,
      mounted: new Function(`return (${mountedSrc})`)(),
    }),
    MOUNTED_ITEMS,
  )

  const scrollSamples = await page.evaluate(
    async (args: { resolveSrc: string; settleSrc: string }) => {
      const scroller = new Function(args.resolveSrc)() as HTMLElement
      const samples: number[] = []
      for (let index = 0; index < 20; index++) {
        const started = performance.now()
        scroller.scrollTop = index % 2 === 0 ? scroller.scrollHeight : 0
        await new Function(`return (${args.settleSrc})`)()
        samples.push(performance.now() - started)
      }
      return samples
    },
    { resolveSrc: RESOLVE_RO_SCROLLER, settleSrc: SETTLE2_SRC },
  )

  // Scrolling to the bottom must reveal the newest items — the last
  // sub-agent group ends up mounted.
  await page.evaluate(
    async (args: { resolveSrc: string; settleSrc: string }) => {
      const scroller = new Function(args.resolveSrc)() as HTMLElement
      for (let attempt = 0; attempt < 40; attempt++) {
        scroller.scrollTop = scroller.scrollHeight
        await new Function(`return (${args.settleSrc})`)()
        // Reveal is complete when the highest-indexed item is a real one, not a
        // placeholder standing in for the not-yet-mounted tail.
        let max = -1
        let maxIsPlaceholder = false
        for (const el of document.querySelectorAll<HTMLElement>('[data-item-index]')) {
          const idx = Number(el.dataset['item-index'])
          if (idx > max) {
            max = idx
            maxIsPlaceholder = el.hasAttribute('data-placeholder')
          }
        }
        if (max >= 0 && !maxIsPlaceholder) break
      }
    },
    { resolveSrc: RESOLVE_RO_SCROLLER, settleSrc: SETTLE2_SRC },
  )
  // The last user message sits just above the final sub-agent group, so its
  // visibility proves the tail of the feed is mounted (post-fix sub-agent
  // bodies are lazy, so a message inside the last group cannot be the gate).
  await expect(page.getByText('Reference workflow request 19', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  })

  const domEnd = await page.evaluate(
    (mountedSrc: string) => ({
      nodes: document.getElementsByTagName('*').length,
      mounted: new Function(`return (${mountedSrc})`)(),
    }),
    MOUNTED_ITEMS,
  )

  const perf = await collectPerf(page)

  const report = {
    case: 'readonly',
    reference: REFERENCE,
    loadMs: Math.round(loadMs),
    domNodesInitial: domInitial.nodes,
    mountedInitial: domInitial.mounted,
    domNodesEnd: domEnd.nodes,
    mountedEnd: domEnd.mounted,
    longtaskCount: perf.longtaskCount,
    longtaskMaxMs: perf.longtaskMaxMs,
    longtaskTotalMs: perf.longtaskTotalMs,
    rafGapMaxMs: perf.rafGapMaxMs,
    rafGapMaxAtMs: perf.rafGapMaxAtMs,
    rafGapP95Ms: perf.rafGapP95Ms,
    scrollP95Ms: Math.round(percentile(scrollSamples, 0.95)),
    net: perf.net,
  }
  console.warn(`LONG_SESSION_PERF ${JSON.stringify(report)}`)

  // The readonly view is immutable content: its node count must stay bounded
  // regardless of how large the session is (the pre-fix view mounted every
  // message — > 13k nodes on the largest real session).
  expect(domInitial.nodes).toBeLessThan(6_000)
  expect(domEnd.nodes).toBeLessThan(6_000)
  expect(perf.longtaskMaxMs).toBeLessThanOrEqual(500)
  expect(percentile(scrollSamples, 0.95)).toBeLessThan(120)
})
