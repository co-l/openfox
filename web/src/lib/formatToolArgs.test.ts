// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { formatToolArgsWithMetadata } from './formatToolArgs.js'

describe('formatToolArgsWithMetadata', () => {
  describe('other tools', () => {
    it('handles read_file with metadata', () => {
      const args = { path: 'src/file.ts', offset: 10, limit: 100 }
      const metadata = undefined

      const result = formatToolArgsWithMetadata('read_file', args, metadata)

      expect(result).toBe('src/file.ts [offset=10, limit=100]')
    })

    it('handles unknown tools gracefully', () => {
      const args = { foo: 'bar' }

      const result = formatToolArgsWithMetadata('unknown_tool', args, undefined)

      expect(result).toBe('{"foo":"bar"}')
    })

    it('formats project_tasks list as just the action', () => {
      const result = formatToolArgsWithMetadata('project_tasks', { action: 'list' }, undefined)

      expect(result).toBe('list')
    })

    it('formats project_tasks mutations as action: taskId with the destination column', () => {
      const result = formatToolArgsWithMetadata(
        'project_tasks',
        { action: 'move', taskId: 'tk_02', to: 'in_progress' },
        undefined,
      )

      expect(result).toBe('move: tk_02 → in_progress')
    })

    it('formats project_tasks set_gate_value with the gate being filled', () => {
      const result = formatToolArgsWithMetadata(
        'project_tasks',
        { action: 'set_gate_value', taskId: 'tk_02', gateId: 'commit', value: 'abc123' },
        undefined,
      )

      expect(result).toBe('set_gate_value: tk_02 (commit)')
    })
  })
})
