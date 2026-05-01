import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileTool } from './read.js'
import { editFileTool } from './edit.js'
import type { ToolContext } from './types.js'
import { SessionManager } from '../session/manager.js'
import { initDatabase, closeDatabase, getDatabase } from '../db/index.js'
import { initEventStore } from '../events/index.js'
import type { Config } from '../../shared/types.js'

const mockProviderManager = {
  getCurrentModelContext: () => 200000,
}

function createTestContext(sessionManager: SessionManager, sessionId: string, workdir: string): ToolContext {
  return {
    sessionManager,
    sessionId,
    workdir,
  }
}

function createTestConfig(): Config {
  return {
    llm: { baseUrl: 'http://localhost:8000/v1', model: 'test', timeout: 1000, idleTimeout: 30000, backend: 'vllm' },
    context: { maxTokens: 100000, compactionThreshold: 0.85, compactionTarget: 0.6 },
    agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 1000 },
    server: { port: 3000, host: 'localhost' },
    database: { path: ':memory:' },
    workdir: process.cwd(),
  }
}

describe('edit_file corruption bug reproduction', () => {
  let testDir: string
  let sessionId: string
  let context: ToolContext
  let sessionManager: SessionManager
  let testFile: string

  beforeEach(async () => {
    initDatabase(createTestConfig())
    initEventStore(getDatabase())
    
    testDir = join(tmpdir(), `openfox-edit-corruption-test-${Date.now()}`)
    await rm(testDir, { recursive: true, force: true })
    await mkdir(testDir, { recursive: true })
    
    sessionManager = new SessionManager(mockProviderManager as any)
    const { createProject } = await import('../db/projects.js')
    const project = createProject('test-project', testDir)
    const session = sessionManager.createSession(project.id)
    sessionId = session.id
    context = createTestContext(sessionManager, sessionId, testDir)
    
    testFile = join(testDir, 'compare.html')
  })

  afterEach(async () => {
    closeDatabase()
    await rm(testDir, { recursive: true, force: true })
  })

  it('reproduces the exact edit sequence from session f5b04e33 that caused silent corruption', async () => {
    const originalContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GPU Benchmark Comparison</title>
</head>
<body>
<div class="section">
    <h2>Efficiency and Price</h2>
    <div class="power-summary">
        <div class="power-card">
            <h3>Power Draw</h3>
            <div class="metric">
                <span class="metric-label">2x Spark</span>
                <span class="metric-value spark" id="sparkPower">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">2x RTX 6000 96GB</span>
                <span class="metric-value rtx" id="rtxPower">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">Ratio</span>
                <span class="metric-value" id="powerRatio">—</span>
            </div>
        </div>
        <div class="power-card">
            <h3>System Cost</h3>
            <div class="metric">
                <span class="metric-label">2x Spark</span>
                <span class="metric-value spark" id="sparkPrice">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">2x RTX 6000 96GB</span>
                <span class="metric-value rtx" id="rtxPrice">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">Ratio</span>
                <span class="metric-value" id="priceRatio">—</span>
            </div>
        </div>
    </div>
</div>
<script>
  async function init() {
    const sparkJson = { power_watts: 300, price_dollars: 5000 }
    const rtxJson = { power_watts: 450, price_dollars: 8000 }
    
    document.getElementById('sparkPower').textContent = sparkJson.power_watts + ' W'
    document.getElementById('rtxPower').textContent = rtxJson.power_watts + ' W'
    document.getElementById('powerRatio').textContent = (sparkJson.power_watts / rtxJson.power_watts).toFixed(2) + 'x'
    document.getElementById('sparkPrice').textContent = '$' + sparkJson.price_dollars.toLocaleString()
    document.getElementById('rtxPrice').textContent = '$' + rtxJson.price_dollars.toLocaleString()
    document.getElementById('priceRatio').textContent = (rtxJson.price_dollars / sparkJson.price_dollars).toFixed(1) + 'x'

    const green = '#4ade80'
    const avgPPspark = 5000
    const avgPPrtx = 4500
    const avgTGspark = 4500
    const avgTGrtx = 4000
  }
  init()
</script>
</body>
</html>`

    await writeFile(testFile, originalContent, 'utf-8')
    await readFileTool.execute({ path: 'compare.html' }, context)
    
    // First edit - matches session seq 900
    const firstOldString = `<div class="power-card">
            <h3>System Cost</h3>
            <div class="metric">
                <span class="metric-label">2x Spark</span>
                <span class="metric-value spark" id="sparkPrice">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">2x RTX 6000 96GB</span>
                <span class="metric-value rtx" id="rtxPrice">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">Ratio</span>
                <span class="metric-value" id="priceRatio">—</span>
            </div>
        </div>
    </div>
</div>`

    const firstNewString = `<div class="power-card">
            <h3>System Cost</h3>
            <div class="metric">
                <span class="metric-label">2x Spark</span>
                <span class="metric-value spark" id="sparkPrice">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">2x RTX 6000 96GB</span>
                <span class="metric-value rtx" id="rtxPrice">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">Ratio</span>
                <span class="metric-value" id="priceRatio">—</span>
            </div>
        </div>
        <div class="power-card">
            <h3>Avg Cost per 1M Tokens @ $0.10/kWh</h3>
            <div class="metric">
                <span class="metric-label">2x Spark (PP)</span>
                <span class="metric-value spark" id="sparkPPCost">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">2x Spark (TG)</span>
                <span class="metric-value spark" id="sparkTGCost">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">2x RTX 6000 96GB (PP)</span>
                <span class="metric-value rtx" id="rtxPPCost">—</span>
            </div>
            <div class="metric">
                <span class="metric-label">2x RTX 6000 96GB (TG)</span>
                <span class="metric-value rtx" id="rtxTGCost">—</span>
            </div>
        </div>
    </div>
</div>`

    const result1 = await editFileTool.execute(
      { path: 'compare.html', old_string: firstOldString, new_string: firstNewString },
      context
    )
    
    expect(result1.success).toBe(true)
    
    // Second edit - matches session seq 982
    const secondOldString = `document.getElementById('priceRatio').textContent = (rtxJson.price_dollars / sparkJson.price_dollars).toFixed(1) + 'x'

    const green = '#4ade80'`

    const secondNewString = `document.getElementById('priceRatio').textContent = (rtxJson.price_dollars / sparkJson.price_dollars).toFixed(1) + 'x'

    const sparkPPCost = (sparkJson.power_watts / 1000) * (1_000_000 / avgPPspark) * 0.10
    const sparkTGCost = (sparkJson.power_watts / 1000) * (1_000_000 / avgTGspark) * 0.10
    const rtxPPCost = (rtxJson.power_watts / 1000) * (1_000_000 / avgPPrtx) * 0.10
    const rtxTGCost = (rtxJson.power_watts / 1000) * (1_000_000 / avgTGrtx) * 0.10
    document.getElementById('sparkPPCost').textContent = '$' + sparkPPCost.toFixed(2)
    document.getElementById('sparkTGCost').textContent = '$' + sparkTGCost.toFixed(2)
    document.getElementById('rtxPPCost').textContent = '$' + rtxPPCost.toFixed(2)
    document.getElementById('rtxTGCost').textContent = '$' + rtxTGCost.toFixed(2)

    const green = '#4ade80'`

    const result2 = await editFileTool.execute(
      { path: 'compare.html', old_string: secondOldString, new_string: secondNewString },
      context
    )
    
    expect(result2.success).toBe(true)
    
    // The bug manifests on the second edit - file gets corrupted with multiple </html> tags
    // This happens even though the edit reports success
    const { readFile } = await import('node:fs/promises')
    const content2 = await readFile(testFile, 'utf-8')
    const htmlCount2 = (content2.match(/<\/html>/g) || []).length
    
    // BUG: htmlCount2 is 5 instead of 1 - the second edit silently corrupted the file
    expect(htmlCount2).toBe(1)
    expect(content2.trim().endsWith('</html>')).toBe(true)
  })
})