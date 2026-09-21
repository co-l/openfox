import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  computeDisabledServersForProject,
  setGlobalMcpServersProvider,
  initSessionMcpOverrides,
  getSessionDisabledServers,
  setSessionDisabledServers,
  clearSessionOverrides,
} from './session-overrides.js'
import { initDatabase, closeDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'
import { createProject, updateProject } from '../db/projects.js'

describe('session-overrides', () => {
  beforeEach(() => {
    initDatabase(loadConfig())
    setGlobalMcpServersProvider(null)
  })

  afterEach(() => {
    setGlobalMcpServersProvider(null)
    closeDatabase()
  })

  describe('computeDisabledServersForProject', () => {
    it('returns empty array when no servers and no overrides exist', () => {
      expect(computeDisabledServersForProject(null, [])).toEqual([])
      expect(computeDisabledServersForProject(undefined, [])).toEqual([])
      expect(computeDisabledServersForProject({}, [])).toEqual([])
    })

    it('falls back to global server disabled flag when no project override exists', () => {
      const globalServers = [
        { name: 'server1', disabled: false },
        { name: 'server2', disabled: true },
        { name: 'server3', disabled: false },
      ]

      const disabled = computeDisabledServersForProject(null, globalServers)
      expect(disabled).toEqual(['server2'])
    })

    it('honors project override disabled: true for a server', () => {
      const globalServers = [
        { name: 'server1', disabled: false },
        { name: 'server2', disabled: false },
      ]
      const projectOverrides = {
        server1: { disabled: true },
      }

      const disabled = computeDisabledServersForProject(projectOverrides, globalServers)
      expect(disabled).toEqual(['server1'])
    })

    it('honors project override disabled: false to re-enable globally disabled server', () => {
      const globalServers = [
        { name: 'server1', disabled: true },
        { name: 'server2', disabled: true },
      ]
      const projectOverrides = {
        server1: { disabled: false },
      }

      const disabled = computeDisabledServersForProject(projectOverrides, globalServers)
      expect(disabled).toEqual(['server2'])
    })

    it('handles servers in project overrides that are not in global server list', () => {
      const globalServers = [{ name: 'server1', disabled: false }]
      const projectOverrides = {
        server2: { disabled: true },
      }

      const disabled = computeDisabledServersForProject(projectOverrides, globalServers)
      expect(disabled).toEqual(['server2'])
    })

    it('disables all servers when all are set to disabled in project overrides', () => {
      const globalServers = [
        { name: 'server1', disabled: false },
        { name: 'server2', disabled: false },
      ]
      const projectOverrides = {
        server1: { disabled: true },
        server2: { disabled: true },
      }

      const disabled = computeDisabledServersForProject(projectOverrides, globalServers)
      expect(disabled.sort()).toEqual(['server1', 'server2'].sort())
    })

    it('uses globalMcpServersProvider when globalServers argument is omitted', () => {
      setGlobalMcpServersProvider(() => [
        { name: 'alpha', disabled: true },
        { name: 'beta', disabled: false },
      ])

      const disabled = computeDisabledServersForProject()
      expect(disabled).toEqual(['alpha'])
    })
  })

  describe('initSessionMcpOverrides', () => {
    it('initializes session overrides from project in database', () => {
      const project = createProject('Test Project', '/tmp/test')
      updateProject(project.id, {
        mcpOverrides: {
          'project-disabled-server': { disabled: true },
        },
      })

      const sessionId = 'session-test-1'
      initSessionMcpOverrides(sessionId, project.id)

      expect(getSessionDisabledServers(sessionId)).toEqual(['project-disabled-server'])
    })

    it('initializes session overrides when projectOverrides argument is passed directly', () => {
      const sessionId = 'session-test-2'
      initSessionMcpOverrides(sessionId, 'any-project', {
        'direct-disabled-server': { disabled: true },
      })

      expect(getSessionDisabledServers(sessionId)).toEqual(['direct-disabled-server'])
    })

    it('clears session overrides on clearSessionOverrides', () => {
      const sessionId = 'session-test-3'
      setSessionDisabledServers(sessionId, ['server1', 'server2'])
      expect(getSessionDisabledServers(sessionId)).toEqual(['server1', 'server2'])

      clearSessionOverrides(sessionId)
      expect(getSessionDisabledServers(sessionId)).toEqual([])
    })
  })
})
