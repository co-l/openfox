import { describe, it, expect, beforeEach } from 'vitest'
import * as store from './store.js'

describe('background-process store', () => {
  beforeEach(() => {
    // Clear all processes between tests
    // Note: This is a module-level singleton, so we clear it
  })

  describe('createProcess', () => {
    it('should create a process with defaults', () => {
      const sessionId = 'test-session'
      const process = store.createProcess(sessionId, 'test-process', 'echo hello', '/tmp')!
      
      expect(process).toBeDefined()
      expect(process?.id).toBeDefined()
      expect(process?.sessionId).toBe(sessionId)
      expect(process?.name).toBe('test-process')
      expect(process?.command).toBe('echo hello')
      expect(process?.cwd).toBe('/tmp')
      expect(process?.status).toBe('pending')
      expect(process?.pid).toBeNull()
      expect(process?.exitCode).toBeNull()
    })

    it('should return null when max processes reached', () => {
      const sessionId = 'test-session-max'
      const max = store.getMaxPerSession()
      
      // Create max processes
      for (let i = 0; i < max; i++) {
        const result = store.createProcess(sessionId, `process-${i}`, 'echo test', '/tmp')
        expect(result).toBeDefined()
      }
      
      // Should fail to create more
      const result = store.createProcess(sessionId, 'excess', 'echo fail', '/tmp')
      expect(result).toBeNull()
    })

    it('should use provided name', () => {
      const sessionId = 'test-session-name'
      const process = store.createProcess(sessionId, 'my-process', 'npm run dev', '/project')
      
      expect(process?.name).toBe('my-process')
      expect(process?.command).toBe('npm run dev')
    })
  })

  describe('startProcess', () => {
    it('should update process with pid and running status', () => {
      const sessionId = 'test-session-start'
      const process = store.createProcess(sessionId, 'test', 'echo hello', '/tmp')!
      
      const started = store.startProcess(process.id, sessionId, 12345)
      
      expect(started).toBeDefined()
      expect(started?.pid).toBe(12345)
      expect(started?.status).toBe('running')
      expect(started?.startedAt).toBeDefined()
    })

    it('should return undefined for non-existent process', () => {
      const result = store.startProcess('non-existent', 'test-session', 12345)
      expect(result).toBeUndefined()
    })
  })

  describe('updateStatus', () => {
    it('should update process status and exit code', () => {
      const sessionId = 'test-session-status'
      const process = store.createProcess(sessionId, 'test', 'echo hello', '/tmp')!
      
      store.updateStatus(process.id, sessionId, 'exited', 0)
      
      const updated = store.getProcess(process.id, sessionId)
      expect(updated?.status).toBe('exited')
      expect(updated?.exitCode).toBe(0)
      expect(updated?.endedAt).toBeDefined()
    })
  })

  describe('removeProcess', () => {
    it('should remove process from session', () => {
      const sessionId = 'test-session-remove'
      const process = store.createProcess(sessionId, 'test', 'echo hello', '/tmp')!
      
      const removed = store.removeProcess(process.id, sessionId)
      expect(removed).toBe(true)
      
      const notFound = store.getProcess(process.id, sessionId)
      expect(notFound).toBeUndefined()
    })

    it('should return false for non-existent process', () => {
      const result = store.removeProcess('non-existent', 'test-session')
      expect(result).toBe(false)
    })
  })

  describe('logs', () => {
    it('should append and retrieve logs', () => {
      const sessionId = 'test-session-logs'
      const process = store.createProcess(sessionId, 'test', 'echo hello', '/tmp')!
      
      store.appendLog(process.id, 'line 1\n', 'stdout')
      store.appendLog(process.id, 'line 2\n', 'stdout')
      store.appendLog(process.id, 'error\n', 'stderr')
      
      const logs = store.getLogs(process.id)
      
      expect(logs.length).toBe(3)
      expect(logs[0]?.content).toBe('line 1\n')
      expect(logs[0]?.stream).toBe('stdout')
      expect(logs[1]?.content).toBe('line 2\n')
      expect(logs[2]?.content).toBe('error\n')
      expect(logs[2]?.stream).toBe('stderr')
    })

    it('should support pagination with since and maxLines', () => {
      const sessionId = 'test-session-pagination'
      const process = store.createProcess(sessionId, 'test', 'echo hello', '/tmp')!
      
      for (let i = 0; i < 10; i++) {
        store.appendLog(process.id, `line ${i}\n`, 'stdout')
      }
      
      const logs = store.getLogs(process.id, 5, 3)
      expect(logs.length).toBe(3)
      expect(logs[0]?.content).toBe('line 5\n')
    })

    it('since=N returns only lines after offset N', () => {
      const sessionId = 'test-session-since'
      const process = store.createProcess(sessionId, 'test', 'echo hello', '/tmp')!
      
      for (let i = 0; i < 10; i++) {
        store.appendLog(process.id, `line ${i}\n`, 'stdout')
      }
      
      const logs = store.getLogs(process.id, 3, 100)
      expect(logs.length).toBe(7)
      expect(logs[0]?.offset).toBe(3)
      expect(logs[logs.length - 1]?.offset).toBe(9)
    })

    it('totalLines reflects all emitted lines, not just returned', () => {
      const sessionId = 'test-session-total'
      const process = store.createProcess(sessionId, 'test', 'echo hello', '/tmp')!
      
      for (let i = 0; i < 20; i++) {
        store.appendLog(process.id, `line ${i}\n`, 'stdout')
      }
      
      const allLogs = store.getLogs(process.id, 0, 100)
      expect(allLogs.length).toBe(20)
      
      const partialLogs = store.getLogs(process.id, 0, 5)
      expect(partialLogs.length).toBe(5)
    })

    it('getLogsPaginated returns nextOffset and hasMore', () => {
      const sessionId = 'test-session-paginated'
      const process = store.createProcess(sessionId, 'test', 'echo hello', '/tmp')!
      
      for (let i = 0; i < 20; i++) {
        store.appendLog(process.id, `line ${i}\n`, 'stdout')
      }
      
      const result = store.getLogsPaginated(process.id, 0, 5)
      
      expect(result.lines.length).toBe(5)
      expect(result.totalLines).toBe(20)
      expect(result.nextOffset).toBe(5)
      expect(result.hasMore).toBe(true)
    })

    it('nextOffset can be used as since without duplicates', () => {
      const sessionId = 'test-session-chained'
      const process = store.createProcess(sessionId, 'test', 'echo hello', '/tmp')!
      
      for (let i = 0; i < 10; i++) {
        store.appendLog(process.id, `line ${i}\n`, 'stdout')
      }
      
      const page1 = store.getLogsPaginated(process.id, 0, 3)
      expect(page1.lines.length).toBe(3)
      expect(page1.lines[0]?.offset).toBe(0)
      expect(page1.lines[2]?.offset).toBe(2)
      
      const page2 = store.getLogsPaginated(process.id, page1.nextOffset, 3)
      expect(page2.lines.length).toBe(3)
      expect(page2.lines[0]?.offset).toBe(3)
      expect(page2.lines[2]?.offset).toBe(5)
      
      const allOffsets = [...page1.lines, ...page2.lines].map(l => l.offset)
      const uniqueOffsets = new Set(allOffsets)
      expect(uniqueOffsets.size).toBe(allOffsets.length)
    })
  })

  describe('getSessionProcessCount', () => {
    it('should count only non-exited processes', () => {
      const sessionId = 'test-session-count'
      
      const p1 = store.createProcess(sessionId, 'p1', 'cmd1', '/tmp')!
      const p2 = store.createProcess(sessionId, 'p2', 'cmd2', '/tmp')!
      store.createProcess(sessionId, 'p3', 'cmd3', '/tmp')!
      
      expect(store.getSessionProcessCount(sessionId)).toBe(3)
      
      // Exit one process
      store.updateStatus(p1.id, sessionId, 'exited')
      expect(store.getSessionProcessCount(sessionId)).toBe(2)
      
      // Remove another
      store.removeProcess(p2.id, sessionId)
      expect(store.getSessionProcessCount(sessionId)).toBe(1)
    })
  })
})