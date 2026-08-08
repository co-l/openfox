/**
 * Session Provider Reconciliation Tests
 *
 * A deleted provider used to leave its sessions pinned to an id that no longer resolves.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'
import { createProject } from '../db/projects.js'
import { initEventStore } from '../events/index.js'
import { createSession, getSession } from '../db/sessions.js'
import { clearSessionsForDeletedProvider, reconcileSessionProviders } from './provider-reconcile.js'

describe('session provider reconciliation', () => {
  let projectId: string

  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    initEventStore(getDatabase())

    projectId = createProject('Test', '/tmp/test').id
  })

  afterEach(() => {
    closeDatabase()
  })

  it('clears the sessions that referenced a deleted provider', () => {
    const orphaned = createSession(projectId, '/tmp/test', 'orphaned', 'deleted-provider', 'some-model')
    const alsoOrphaned = createSession(projectId, '/tmp/test', 'also orphaned', 'deleted-provider', 'other-model')
    const untouched = createSession(projectId, '/tmp/test', 'untouched', 'kept-provider', 'kept-model')

    expect(clearSessionsForDeletedProvider('deleted-provider')).toBe(2)

    expect(getSession(orphaned.id)?.providerId).toBeNull()
    expect(getSession(orphaned.id)?.providerModel).toBeNull()
    expect(getSession(alsoOrphaned.id)?.providerId).toBeNull()
    expect(getSession(untouched.id)?.providerId).toBe('kept-provider')
    expect(getSession(untouched.id)?.providerModel).toBe('kept-model')
  })

  it('clears a provider that is not configured and leaves a configured one alone', () => {
    const dead = createSession(projectId, '/tmp/test', 'dead', 'gone-provider', 'gone-model')
    const live = createSession(projectId, '/tmp/test', 'live', 'live-provider', 'live-model')
    const unpinned = createSession(projectId, '/tmp/test', 'unpinned')

    expect(reconcileSessionProviders(['live-provider'])).toBe(1)

    expect(getSession(dead.id)?.providerId).toBeNull()
    expect(getSession(dead.id)?.providerModel).toBeNull()
    expect(getSession(live.id)?.providerId).toBe('live-provider')
    expect(getSession(live.id)?.providerModel).toBe('live-model')
    expect(getSession(unpinned.id)?.providerId).toBeNull()
  })

  it('repairs nothing when every pinned provider is configured', () => {
    const pinned = createSession(projectId, '/tmp/test', 'pinned', 'live-provider', 'live-model')

    expect(reconcileSessionProviders(['live-provider', 'another-provider'])).toBe(0)

    expect(getSession(pinned.id)?.providerId).toBe('live-provider')
  })
})
