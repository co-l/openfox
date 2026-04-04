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
  })
})