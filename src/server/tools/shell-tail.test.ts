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

  it('returns null when && precedes the tail (cd prefix)', () => {
    expect(stripTailPipe('cd /home/user/proj && npm test 2>&1 | tail -30')).toBeNull()
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

  it('returns null for &&-chained commands where each segment has its own tail', () => {
    expect(stripTailPipe('cmd1 | tail -3 && cmd2 | tail -2')).toBeNull()
  })

  it('returns null for a chained verify command ending in | tail', () => {
    expect(
      stripTailPipe(
        'npm run typecheck 2>&1 | tail -4 && npm run lint 2>&1 | tail -3 && npx prettier --check src/server/db/tasks.ts src/server/tasks/service.test.ts 2>&1 | tail -3',
      ),
    ).toBeNull()
  })

  it('returns null when || precedes the tail', () => {
    expect(stripTailPipe('fallback_cmd || primary_cmd 2>&1 | tail -10')).toBeNull()
  })

  it('returns null when ; follows the tail', () => {
    expect(stripTailPipe('cmd 2>&1 | tail -5; next_cmd')).toBeNull()
  })

  it('returns null for multiple ;-separated commands each with their own tail', () => {
    expect(
      stripTailPipe(
        'npm run test:unit 2>&1 | tail -4; echo "===TYPECHECK==="; npm run typecheck 2>&1 | tail -2; echo "exit=$?"; echo "===LINT==="; npm run lint 2>&1 | tail -2; echo "===DUPLICATE==="; npm run duplicate 2>&1 | tail -2',
      ),
    ).toBeNull()
  })

  it('returns null when two ;-separated tails end the command', () => {
    expect(stripTailPipe('cmd1 | tail -4; cmd2 | tail -2')).toBeNull()
  })

  it('still strips when ; appears only inside quotes', () => {
    expect(stripTailPipe('echo "a;b" | tail -3')).toEqual({
      command: 'echo "a;b"',
      tailLines: 3,
    })
  })

  it('returns null for a command with a newline separator', () => {
    expect(stripTailPipe('cmd1 | tail -4\ncmd2 | tail -2')).toBeNull()
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
