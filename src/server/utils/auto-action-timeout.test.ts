import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import { createProject, updateProject } from '../db/projects.js'
import { SETTINGS_KEYS, deleteSetting, setSetting } from '../db/settings.js'
import { DEFAULT_AUTO_ACTION_TIMEOUT_SECONDS, resolveAutoActionTimeoutSeconds } from './auto-action-timeout.js'

describe('resolveAutoActionTimeoutSeconds', () => {
  beforeEach(() => {
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
  })

  afterEach(() => {
    deleteSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT)
    closeDatabase()
  })

  it('defaults to 90s with no setting stored', () => {
    expect(resolveAutoActionTimeoutSeconds()).toBe(DEFAULT_AUTO_ACTION_TIMEOUT_SECONDS)
  })

  it('reads the global setting', () => {
    setSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT, '30')
    expect(resolveAutoActionTimeoutSeconds()).toBe(30)
  })

  it('prefers the project override over the global setting', () => {
    const project = createProject('auto-timeout', '/tmp/auto-timeout-project')
    setSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT, '30')

    updateProject(project.id, { autoActionTimeoutSeconds: 10 })
    expect(resolveAutoActionTimeoutSeconds(project.id)).toBe(10)

    updateProject(project.id, { autoActionTimeoutSeconds: null })
    expect(resolveAutoActionTimeoutSeconds(project.id)).toBe(30)
  })

  it('falls back when the value is invalid', () => {
    setSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT, '0')
    expect(resolveAutoActionTimeoutSeconds()).toBe(DEFAULT_AUTO_ACTION_TIMEOUT_SECONDS)
    setSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT, 'abc')
    expect(resolveAutoActionTimeoutSeconds()).toBe(DEFAULT_AUTO_ACTION_TIMEOUT_SECONDS)
    setSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT, '')
    expect(resolveAutoActionTimeoutSeconds()).toBe(DEFAULT_AUTO_ACTION_TIMEOUT_SECONDS)
  })

  it('falls back for an unknown project', () => {
    expect(resolveAutoActionTimeoutSeconds('missing-project')).toBe(DEFAULT_AUTO_ACTION_TIMEOUT_SECONDS)
  })
})
