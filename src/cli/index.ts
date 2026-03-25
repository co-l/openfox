#!/usr/bin/env node
import { runCli } from './main.js'
import { logger } from '../server/utils/logger.js'
runCli({ mode: 'production' }).catch(logger.error)
