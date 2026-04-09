#!/usr/bin/env node
import { runCli } from './main.js'
import { logger } from '../server/utils/logger.js'
import { readFileSync } from "node:fs"

const mode = (process.env['OPENFOX_MODE'] ?? 'development') as 'production' | 'development' | 'test'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

process.env['VERSION']= pkg.version+'-dev'

runCli({ mode }).catch((error) => {
  logger.error('CLI fatal error', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
