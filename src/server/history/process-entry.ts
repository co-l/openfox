import { startHistoryService } from './service.js'

// ============================================================================
// Inline Logger for Separate Process
// Self-contained logger implementation (no external imports needed)
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

let currentLevel: LogLevel = 'info'

// Check OPENFOX_LOG_LEVEL env var
const envLevel = process.env['OPENFOX_LOG_LEVEL']?.toLowerCase()
if (envLevel && LEVELS[envLevel as LogLevel] !== undefined) {
  currentLevel = envLevel as LogLevel
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel]
}

function formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString()
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`
  
  if (context && Object.keys(context).length > 0) {
    return `${prefix} ${message} ${JSON.stringify(context)}`
  }
  
  return `${prefix} ${message}`
}

const processLogger = {
  debug(message: string, context?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, context))
    }
  },
  
  info(message: string, context?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, context))
    }
  },
  
  warn(message: string, context?: Record<string, unknown>): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, context))
    }
  },
  
  error(message: string, context?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, context))
    }
  },
}

async function main(): Promise<void> {
  const workdir = process.argv[2]

  if (!workdir) {
    throw new Error('Missing workdir argument for history process')
  }

  let stopped = false

  let service = null as Awaited<ReturnType<typeof startHistoryService>> | null

  service = await startHistoryService(workdir, {
    onWatcherError: (error) => {
      if (stopped) {
        return
      }

      stopped = true
      processLogger.error('History process watcher failed', { workdir, error: error instanceof Error ? error.message : String(error) })
      service?.stop()
      process.exitCode = 1
      process.exit()
    },
  })

  const shutdown = () => {
    if (stopped) {
      return
    }

    stopped = true
    service.stop()
    process.exitCode = 0
    process.exit()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

process.on('uncaughtException', (error) => {
  processLogger.error('Uncaught history process error', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})

process.on('unhandledRejection', (error) => {
  processLogger.error('Unhandled history process rejection', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})

void main().catch((error) => {
  processLogger.error('Failed to start history process', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
