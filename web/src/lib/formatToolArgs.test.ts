import { describe, expect, it } from 'vitest'
import { formatToolArgsWithMetadata } from './formatToolArgs.js'

describe('formatToolArgsWithMetadata', () => {
  describe('glob tool', () => {
    it('displays pattern with file count when not truncated', () => {
      const args = { pattern: '**/*.ts' }
      const metadata = { pattern: '**/*.ts', totalFound: 15, shownCount: 15, truncated: false }
      
      const result = formatToolArgsWithMetadata('glob', args, metadata)
      
      expect(result).toBe('**/*.ts [15 file(s) found]')
    })

    it('displays pattern with cwd and file count', () => {
      const args = { pattern: '**/*.ts', cwd: 'src' }
      const metadata = { pattern: '**/*.ts', cwd: 'src', totalFound: 15, shownCount: 15, truncated: false }
      
      const result = formatToolArgsWithMetadata('glob', args, metadata)
      
      expect(result).toBe('**/*.ts [cwd=src, 15 file(s) found]')
    })

    it('displays truncated count when results exceed limit', () => {
      const args = { pattern: '**/*.ts' }
      const metadata = { pattern: '**/*.ts', totalFound: 1247, shownCount: 500, truncated: true }
      
      const result = formatToolArgsWithMetadata('glob', args, metadata)
      
      expect(result).toBe('**/*.ts [Showing first 500 of 1247]')
    })

    it('displays truncated count with cwd', () => {
      const args = { pattern: '**/*.ts', cwd: 'src' }
      const metadata = { pattern: '**/*.ts', cwd: 'src', totalFound: 1247, shownCount: 500, truncated: true }
      
      const result = formatToolArgsWithMetadata('glob', args, metadata)
      
      expect(result).toBe('**/*.ts [cwd=src, Showing first 500 of 1247]')
    })

    it('falls back to pattern only when no metadata', () => {
      const args = { pattern: '**/*.ts' }
      
      const result = formatToolArgsWithMetadata('glob', args, undefined)
      
      expect(result).toBe('**/*.ts')
    })
  })

  describe('grep tool', () => {
    it('displays pattern with match count when not truncated', () => {
      const args = { pattern: 'buildVerifierPrompt' }
      const metadata = { pattern: 'buildVerifierPrompt', totalMatches: 10, shownCount: 10, truncated: false }
      
      const result = formatToolArgsWithMetadata('grep', args, metadata)
      
      expect(result).toBe('buildVerifierPrompt [10 match(es) found]')
    })

    it('displays pattern with include and match count', () => {
      const args = { pattern: 'buildVerifierPrompt', include: '*.ts' }
      const metadata = { pattern: 'buildVerifierPrompt', include: '*.ts', totalMatches: 10, shownCount: 10, truncated: false }
      
      const result = formatToolArgsWithMetadata('grep', args, metadata)
      
      expect(result).toBe('buildVerifierPrompt [include=*.ts, 10 match(es) found]')
    })

    it('displays pattern with include, cwd, and match count', () => {
      const args = { pattern: 'buildVerifierPrompt', include: '*.ts', cwd: 'src' }
      const metadata = { pattern: 'buildVerifierPrompt', include: '*.ts', cwd: 'src', totalMatches: 10, shownCount: 10, truncated: false }
      
      const result = formatToolArgsWithMetadata('grep', args, metadata)
      
      expect(result).toBe('buildVerifierPrompt [include=*.ts] [cwd=src, 10 match(es) found]')
    })

    it('displays truncated count when matches exceed limit', () => {
      const args = { pattern: 'alpha' }
      const metadata = { pattern: 'alpha', totalMatches: 500, shownCount: 200, truncated: true }
      
      const result = formatToolArgsWithMetadata('grep', args, metadata)
      
      expect(result).toBe('alpha [Showing first 200 of 500 matches]')
    })

    it('displays truncated count with include and cwd', () => {
      const args = { pattern: 'alpha', include: '*.ts', cwd: 'src' }
      const metadata = { pattern: 'alpha', include: '*.ts', cwd: 'src', totalMatches: 500, shownCount: 200, truncated: true }
      
      const result = formatToolArgsWithMetadata('grep', args, metadata)
      
      expect(result).toBe('alpha [include=*.ts] [cwd=src, Showing first 200 of 500 matches]')
    })

    it('falls back to pattern only when no metadata', () => {
      const args = { pattern: 'buildVerifierPrompt' }
      
      const result = formatToolArgsWithMetadata('grep', args, undefined)
      
      expect(result).toBe('buildVerifierPrompt')
    })
  })

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
