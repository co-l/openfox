import { describe, it, expect } from 'vitest'
import { stripTailPipe } from './shell-tail.js'

describe('stripTailPipe', () => {
  it('strips | tail -N at end of command', () => {
    expect(stripTailPipe('npm run test:unit 2>&1 | tail -50')).toEqual({
      command: 'npm run test:unit 2>&1',
      tailLines: 50,
    })
  })

  it('strips | tail -n N at end of command', () => {
    expect(stripTailPipe('npm run build 2>&1 | tail -n 20')).toEqual({
      command: 'npm run build 2>&1',
      tailLines: 20,
    })
  })

  it('strips | tail -N with cd prefix', () => {
    expect(stripTailPipe('cd /home/user/proj && npm test 2>&1 | tail -30')).toEqual({
      command: 'cd /home/user/proj && npm test 2>&1',
      tailLines: 30,
    })
  })

  it('strips tail from multi-pipe command', () => {
    expect(stripTailPipe('cmd1 | grep foo | tail -20')).toEqual({
      command: 'cmd1 | grep foo',
      tailLines: 20,
    })
  })

  it('returns null when no tail present', () => {
    expect(stripTailPipe('npm run test:unit')).toBeNull()
  })

  it('returns null when tail is in a string argument', () => {
    expect(stripTailPipe('echo "tail -50"')).toBeNull()
  })

  it('returns null for | tail -f (follow mode)', () => {
    expect(stripTailPipe('tail -f /var/log/syslog')).toBeNull()
  })

  it('returns null for | tail -n +N (starting line)', () => {
    expect(stripTailPipe('cat file | tail -n +20')).toBeNull()
  })

  it('returns null when && follows the tail', () => {
    expect(stripTailPipe('./deploy.sh 2>&1 | tail -3 && git add -A')).toBeNull()
  })

  it('returns null when || follows the tail', () => {
    expect(stripTailPipe('cmd 2>&1 | tail -10 || echo "failed"')).toBeNull()
  })

  it('returns null when ; follows the tail', () => {
    expect(stripTailPipe('cmd 2>&1 | tail -5; next_cmd')).toBeNull()
  })

  it('returns null for empty command', () => {
    expect(stripTailPipe('')).toBeNull()
  })

  it('returns null for | tail with no number', () => {
    expect(stripTailPipe('cmd | tail')).toBeNull()
  })

  it('handles tail -1 (single line)', () => {
    expect(stripTailPipe('echo test | tail -1')).toEqual({
      command: 'echo test',
      tailLines: 1,
    })
  })

  it('handles tail -300 (large value)', () => {
    expect(stripTailPipe('npx vitest run 2>&1 | tail -300')).toEqual({
      command: 'npx vitest run 2>&1',
      tailLines: 300,
    })
  })

  it('handles command with no redirect before tail', () => {
    expect(stripTailPipe('npm run tree | tail -20')).toEqual({
      command: 'npm run tree',
      tailLines: 20,
    })
  })

  it('handles tail with extra whitespace', () => {
    expect(stripTailPipe('cmd 2>&1  |  tail  -50')).toEqual({
      command: 'cmd 2>&1',
      tailLines: 50,
    })
  })
})
