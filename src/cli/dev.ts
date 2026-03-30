#!/usr/bin/env node
import { runCli } from './main.js'
import { logger } from '../server/utils/logger.js'

const mode = (process.env['OPENFOX_MODE'] ?? 'development') as 'production' | 'development' | 'test'
runCli({ mode }).catch((error) => {
  logger.error('CLI fatal error', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
