import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultLogLevel, logger, setLogLevel } from './logger.js'

describe('logger', () => {
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    debugSpy.mockClear()
    infoSpy.mockClear()
    warnSpy.mockClear()
    errorSpy.mockClear()
  })

  afterEach(() => {
    setLogLevel('info')
  })

  it('uses mode defaults and respects log filtering', () => {
    expect(getDefaultLogLevel('development')).toBe('debug')
    expect(getDefaultLogLevel('production')).toBe('warn')

    setLogLevel(undefined, 'development')
    logger.debug('debug message', { scope: 'test' })
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] debug message'))

    setLogLevel(undefined, 'production')
    logger.info('info hidden')
    logger.warn('warn shown')
    logger.error('error shown')
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] warn shown'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] error shown'))
  })
})
