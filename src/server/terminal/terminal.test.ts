import { describe, it, expect, afterEach } from 'vitest'
import { terminalManager } from './manager.js'

describe('TerminalManager', () => {
  afterEach(() => {
    terminalManager.killAll()
  })

  describe('create', () => {
    it('creates a terminal with generated id', () => {
      const session = terminalManager.create()
      expect(session.id).toMatch(/^term_/)
      expect(session.workdir).toBeDefined()
    })

    it('creates a terminal with custom workdir', () => {
      const session = terminalManager.create('/tmp')
      expect(session.workdir).toBe('/tmp')
    })
  })

  describe('getAll', () => {
    it('returns empty array when no sessions', () => {
      expect(terminalManager.getAll()).toEqual([])
    })

    it('returns all created sessions', () => {
      const s1 = terminalManager.create()
      const s2 = terminalManager.create()
      const sessions = terminalManager.getAll()
      expect(sessions).toHaveLength(2)
      expect(sessions.map((s) => s.id)).toContain(s1.id)
      expect(sessions.map((s) => s.id)).toContain(s2.id)
    })
  })

  describe('get', () => {
    it('returns session by id', () => {
      const created = terminalManager.create()
      const found = terminalManager.get(created.id)
      expect(found?.id).toBe(created.id)
    })

    it('returns undefined for non-existent id', () => {
      expect(terminalManager.get('nonexistent')).toBeUndefined()
    })
  })

  describe('kill', () => {
    it('removes session from getAll', () => {
      const session = terminalManager.create()
      expect(terminalManager.getAll()).toHaveLength(1)

      terminalManager.kill(session.id)

      expect(terminalManager.getAll()).toHaveLength(0)
      expect(terminalManager.get(session.id)).toBeUndefined()
    })

    it('returns false for non-existent session', () => {
      expect(terminalManager.kill('nonexistent')).toBe(false)
    })

    it('returns true for successful kill', () => {
      const session = terminalManager.create()
      expect(terminalManager.kill(session.id)).toBe(true)
    })
  })

  describe('write', () => {
    it('returns false for non-existent session', () => {
      expect(terminalManager.write('nonexistent', 'test')).toBe(false)
    })
  })

  describe('resize', () => {
    it('returns false for non-existent session', () => {
      expect(terminalManager.resize('nonexistent', 80, 24)).toBe(false)
    })
  })
})
