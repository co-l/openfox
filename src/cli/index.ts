#!/usr/bin/env node
const MIN_HEAP_MB = 6_144
const DEFAULT_HEAP_MB = 8_192

function getCurrentHeapMB(): number {
  const arg = process.execArgv.find((a) => a.startsWith('--max-old-space-size='))
  if (arg) return Number.parseInt(arg.split('=')[1]!, 10)
  const m = (process.env['NODE_OPTIONS'] ?? '').match(/--max-old-space-size=(\d+)/)
  return m ? Number.parseInt(m[1]!, 10) : 0
}

const currentHeap = getCurrentHeapMB()
if (currentHeap < MIN_HEAP_MB && !process.env['OPENFOX_HEAP_INCREASED']) {
  const { spawnSync } = await import('node:child_process')
  const { totalmem } = await import('node:os')
  const heapMB = Math.min(DEFAULT_HEAP_MB, Math.max(4_096, Math.floor((totalmem() / (1024 * 1024)) * 0.55)))
  const env: Record<string, string | undefined> = { ...process.env, OPENFOX_HEAP_INCREASED: '1' }
  const cleanNodeOptions = (env['NODE_OPTIONS'] ?? '').replace(/--max-old-space-size=\d+/g, '').trim()
  env['NODE_OPTIONS'] = cleanNodeOptions || undefined
  const scriptPath = process.argv[1] as string
  const result = spawnSync(
    process.execPath,
    ['--max-old-space-size=' + heapMB, ...process.execArgv, scriptPath, ...process.argv.slice(2)],
    { stdio: 'inherit', env: env as Record<string, string>, windowsHide: true },
  )
  process.exit(result.status ?? 0)
}

import { runCli } from './main.js'
import { logger } from '../server/utils/logger.js'

const mode = (process.env['OPENFOX_MODE'] ?? 'production') as 'production' | 'development' | 'test'
runCli({ mode }).catch((error) => {
  logger.error('CLI fatal error', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
