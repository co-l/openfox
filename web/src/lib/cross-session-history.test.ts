import { describe, expect, it } from 'vitest'
import { formatTimestampLocal, trimContent } from './cross-session-history'

describe('cross-session-history', () => {
  describe('formatTimestampLocal', () => {
    it('formats ISO timestamp to YYYY/MM/DD HH:MM in local time', () => {
      const result = formatTimestampLocal('2026-03-24T16:30:45Z')
      expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)
    })

    it('pads single digit months and days', () => {
      expect(formatTimestampLocal('2026-03-05T10:05:00Z')).toMatch(/2026\/03\/05/)
    })
  })

  describe('trimContent', () => {
    it('returns content as-is if within limit', () => {
      expect(trimContent('Short text', 150)).toBe('Short text')
    })

    it('trims to maxLength and adds ellipsis', () => {
      const result = trimContent('A'.repeat(200), 150)
      expect(result.length).toBe(153)
      expect(result).toContain('...')
    })
  })
})
