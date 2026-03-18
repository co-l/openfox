type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type Mode = 'development' | 'production'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

let currentLevel: LogLevel = 'info'

export function setLogLevel(level?: LogLevel, mode?: Mode): void {
  // Use mode-based default if no level specified
  if (mode && !level) {
    currentLevel = mode === 'development' ? 'debug' : 'warn'
  } else {
    currentLevel = level ?? 'info'
  }
}

export function getDefaultLogLevel(mode: Mode): LogLevel {
  return mode === 'development' ? 'debug' : 'warn'
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

export const logger = {
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
