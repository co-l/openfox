import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  requestPathAccess,
  PathAccessDeniedError,
  providePathConfirmation,
  hasPendingPathConfirmation,
  clearAllowedPaths,
  cancelPathConfirmationsForSession,
  getSessionAllowedRules,
} from './path-security.js'
import type { PermissionRule } from '../permissions/schema.js'

vi.mock('../utils/platform.js', () => ({
  getPlatformShell: vi.fn(() => ({ command: '/bin/sh', args: ['-c'] })),
}))

const TEST_DIR = join(tmpdir(), 'openfox-path-security-rules-test')
const WORKDIR = join(TEST_DIR, 'workdir')
const OUTSIDE = '/var/lib/openfox-rules-test'

const noOpEvent = vi.fn()

function rule(effect: PermissionRule['effect'], tool: string, pattern?: string): PermissionRule {
  return { effect, tool, ...(pattern !== undefined ? { pattern } : {}) }
}

beforeEach(() => {
  noOpEvent.mockClear()
  clearAllowedPaths('rules-session')
  cancelPathConfirmationsForSession('rules-session', 'cleanup')
})

afterEach(() => {
  cancelPathConfirmationsForSession('rules-session', 'cleanup')
  clearAllowedPaths('rules-session')
})

describe('requestPathAccess with permission rules', () => {
  it('DENY rule on read_file throws PathAccessDeniedError, no prompt emitted', async () => {
    const rules = [rule('DENY', 'read_file', '/secret/**')]
    await expect(
      requestPathAccess(
        ['/secret/key.pem'],
        WORKDIR,
        'rules-session',
        'c1',
        'read_file',
        noOpEvent,
        'normal',
        undefined,
        false,
        rules,
      ),
    ).rejects.toMatchObject({
      name: 'PathAccessDeniedError',
      reason: 'rule_denied',
    })
    expect(noOpEvent).not.toHaveBeenCalled()
    expect(hasPendingPathConfirmation('c1')).toBe(false)
  })

  it('ALLOW rule on read_file for outside-workdir path: no prompt, allowed', async () => {
    const rules = [rule('ALLOW', 'read_file', '/ubiquity/**')]
    await expect(
      requestPathAccess(
        ['/ubiquity/deploy.yaml'],
        WORKDIR,
        'rules-session',
        'c2',
        'read_file',
        noOpEvent,
        'normal',
        undefined,
        false,
        rules,
      ),
    ).resolves.toBeUndefined()
    expect(noOpEvent).not.toHaveBeenCalled()
  })

  it('ASK rule on write_file forces prompt even for path inside workdir', async () => {
    const target = join(WORKDIR, '.env')
    const rules = [rule('ASK', 'write_file', '**/.env*')]
    const promise = requestPathAccess(
      [target],
      WORKDIR,
      'rules-session',
      'c3',
      'write_file',
      noOpEvent,
      'normal',
      undefined,
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation('c3'); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation('c3')).toBe(true)
    providePathConfirmation('c3', false)
    await expect(promise).rejects.toMatchObject({ name: 'PathAccessDeniedError' })
  })

  it('DENY rule on run_command blocks command before execution, no prompt', async () => {
    const rules = [rule('DENY', 'run_command', 'rm -rf *')]
    await expect(
      requestPathAccess(
        [],
        WORKDIR,
        'rules-session',
        'c4',
        'run_command',
        noOpEvent,
        'normal',
        'rm -rf /home/x',
        false,
        rules,
      ),
    ).rejects.toMatchObject({
      name: 'PathAccessDeniedError',
      reason: 'rule_denied',
    })
    expect(noOpEvent).not.toHaveBeenCalled()
  })

  it('no rules → exact same behavior as today (regression: outside path prompts)', async () => {
    const promise = requestPathAccess(
      [OUTSIDE],
      WORKDIR,
      'rules-session',
      'c5',
      'read_file',
      noOpEvent,
      'normal',
      undefined,
      false,
      undefined,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation('c5'); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation('c5')).toBe(true)
    providePathConfirmation('c5', false)
    await expect(promise).rejects.toMatchObject({ name: 'PathAccessDeniedError' })
  })

  it('DENY rule wins even in dangerous mode (explicit guardrail)', async () => {
    const rules = [rule('DENY', 'read_file', '/secret/**')]
    await expect(
      requestPathAccess(
        ['/secret/key.pem'],
        WORKDIR,
        'rules-session',
        'c6',
        'read_file',
        noOpEvent,
        'dangerous',
        undefined,
        false,
        rules,
      ),
    ).rejects.toMatchObject({
      name: 'PathAccessDeniedError',
      reason: 'rule_denied',
    })
  })

  it('ALLOW rule in dangerous mode: allowed, no prompt', async () => {
    const rules = [rule('ALLOW', 'read_file', '/ubiquity/**')]
    await expect(
      requestPathAccess(
        ['/ubiquity/a.yaml'],
        WORKDIR,
        'rules-session',
        'c7',
        'read_file',
        noOpEvent,
        'dangerous',
        undefined,
        false,
        rules,
      ),
    ).resolves.toBeUndefined()
    expect(noOpEvent).not.toHaveBeenCalled()
  })

  it('ASK rule in dangerous mode: dangerous bypasses ASK (no prompt)', async () => {
    const target = join(WORKDIR, '.env')
    const rules = [rule('ASK', 'write_file', '**/.env*')]
    await expect(
      requestPathAccess(
        [target],
        WORKDIR,
        'rules-session',
        'c8',
        'write_file',
        noOpEvent,
        'dangerous',
        undefined,
        false,
        rules,
      ),
    ).resolves.toBeUndefined()
    expect(noOpEvent).not.toHaveBeenCalled()
  })

  it('rule_denied error has descriptive message', async () => {
    const rules = [rule('DENY', 'run_command', 'rm -rf *')]
    try {
      await requestPathAccess(
        [],
        WORKDIR,
        'rules-session',
        'c9',
        'run_command',
        noOpEvent,
        'normal',
        'rm -rf /x',
        false,
        rules,
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PathAccessDeniedError)
      expect((err as PathAccessDeniedError).message).toContain('rm -rf /x')
      expect((err as PathAccessDeniedError).reason).toBe('rule_denied')
    }
  })

  it('DENY on second path wins over ALLOW on first path (cross-target precedence)', async () => {
    const rules = [rule('ALLOW', 'read_file', '/workdir/**'), rule('DENY', 'read_file', '/secret/**')]
    await expect(
      requestPathAccess(
        ['/workdir/a.txt', '/secret/key.pem'],
        WORKDIR,
        'rules-session',
        'c10',
        'read_file',
        noOpEvent,
        'normal',
        undefined,
        false,
        rules,
      ),
    ).rejects.toMatchObject({
      name: 'PathAccessDeniedError',
      reason: 'rule_denied',
    })
  })

  it('ALLOW rule does NOT bypass git --no-verify confirmation (always-confirm guard)', async () => {
    const rules = [rule('ALLOW', 'run_command', 'git *')]
    const promise = requestPathAccess(
      [],
      WORKDIR,
      'rules-session',
      'c11',
      'run_command',
      noOpEvent,
      'normal',
      'git commit --no-verify -m "skip"',
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation('c11'); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation('c11')).toBe(true)
    providePathConfirmation('c11', false)
    await expect(promise).rejects.toMatchObject({ name: 'PathAccessDeniedError' })
  })

  it('ALLOW rule does NOT bypass dangerous-command confirmation (always-confirm guard)', async () => {
    const rules = [rule('ALLOW', 'run_command', 'rm *')]
    const promise = requestPathAccess(
      [],
      WORKDIR,
      'rules-session',
      'c12',
      'run_command',
      noOpEvent,
      'normal',
      'rm -rf ~',
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation('c12'); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation('c12')).toBe(true)
    providePathConfirmation('c12', false)
    await expect(promise).rejects.toMatchObject({ name: 'PathAccessDeniedError' })
  })

  it('ASK rule with sub-agent: fails closed (no bypass via sub-agent shortcut)', async () => {
    const target = join(WORKDIR, '.env')
    const rules = [rule('ASK', 'write_file', '**/.env*')]
    await expect(
      requestPathAccess(
        [target],
        WORKDIR,
        'rules-session',
        'c13',
        'write_file',
        noOpEvent,
        'normal',
        undefined,
        true,
        rules,
      ),
    ).rejects.toMatchObject({ name: 'PathAccessDeniedError', reason: 'rule_ask' })
    expect(noOpEvent).not.toHaveBeenCalled()
  })

  it('ASK rule with sub-agent in dangerous mode: bypassed (dangerous overrides ASK)', async () => {
    const target = join(WORKDIR, '.env')
    const rules = [rule('ASK', 'write_file', '**/.env*')]
    await expect(
      requestPathAccess(
        [target],
        WORKDIR,
        'rules-session',
        'c14',
        'write_file',
        noOpEvent,
        'dangerous',
        undefined,
        true,
        rules,
      ),
    ).resolves.toBeUndefined()
  })
})

describe('requestPathAccess: Allow for this session (rule ASK → ALLOW ephemeral)', () => {
  it('ASK rule → allow for session → 2nd call same pattern: no prompt', async () => {
    const rules = [rule('ASK', 'run_command', 'terragrunt destroy *')]
    const cmd = 'terragrunt destroy -auto-approve'
    const callId1 = 's1'
    const promise1 = requestPathAccess(
      [],
      WORKDIR,
      'rules-session',
      callId1,
      'run_command',
      noOpEvent,
      'normal',
      cmd,
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation(callId1); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation(callId1)).toBe(true)
    providePathConfirmation(callId1, true, true)
    await expect(promise1).resolves.toBeUndefined()

    noOpEvent.mockClear()
    const sessionRules = [...rules, ...getSessionAllowedRules('rules-session')]
    const callId2 = 's2'
    await expect(
      requestPathAccess(
        [],
        WORKDIR,
        'rules-session',
        callId2,
        'run_command',
        noOpEvent,
        'normal',
        cmd,
        false,
        sessionRules,
      ),
    ).resolves.toBeUndefined()
    expect(noOpEvent).not.toHaveBeenCalled()
  })

  it('ASK rule → deny → 2nd call: re-prompts (no clone)', async () => {
    const rules = [rule('ASK', 'run_command', 'terragrunt destroy *')]
    const cmd = 'terragrunt destroy -auto-approve'
    const callId1 = 'd1'
    const promise1 = requestPathAccess(
      [],
      WORKDIR,
      'rules-session',
      callId1,
      'run_command',
      noOpEvent,
      'normal',
      cmd,
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation(callId1); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation(callId1)).toBe(true)
    providePathConfirmation(callId1, false)
    await expect(promise1).rejects.toMatchObject({ name: 'PathAccessDeniedError', reason: 'rule_ask' })

    expect(getSessionAllowedRules('rules-session')).toHaveLength(0)
  })

  it('ASK rule → allow one-shot (alwaysAllow=false) → 2nd call: re-prompts', async () => {
    const rules = [rule('ASK', 'run_command', 'terragrunt destroy *')]
    const cmd = 'terragrunt destroy -auto-approve'
    const callId1 = 'o1'
    const promise1 = requestPathAccess(
      [],
      WORKDIR,
      'rules-session',
      callId1,
      'run_command',
      noOpEvent,
      'normal',
      cmd,
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation(callId1); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation(callId1)).toBe(true)
    providePathConfirmation(callId1, true, false)
    await expect(promise1).resolves.toBeUndefined()

    expect(getSessionAllowedRules('rules-session')).toHaveLength(0)
  })

  it('DENY disk rule + ALLOW ephemeral session rule on same pattern: DENY wins (3>2)', async () => {
    const denyRule = rule('DENY', 'run_command', 'terragrunt destroy *')
    const askRule = rule('ASK', 'run_command', 'terragrunt destroy *')
    const cmd = 'terragrunt destroy -auto-approve'
    const callId1 = 'p1'
    const promise1 = requestPathAccess(
      [],
      WORKDIR,
      'rules-session',
      callId1,
      'run_command',
      noOpEvent,
      'normal',
      cmd,
      false,
      [askRule],
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation(callId1); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation(callId1)).toBe(true)
    providePathConfirmation(callId1, true, true)
    await expect(promise1).resolves.toBeUndefined()

    const sessionRules = [denyRule, ...getSessionAllowedRules('rules-session')]
    const callId2 = 'p2'
    await expect(
      requestPathAccess(
        [],
        WORKDIR,
        'rules-session',
        callId2,
        'run_command',
        noOpEvent,
        'normal',
        cmd,
        false,
        sessionRules,
      ),
    ).rejects.toMatchObject({ name: 'PathAccessDeniedError', reason: 'rule_denied' })
  })

  it('clearAllowedRules → 2nd call re-prompts', async () => {
    const rules = [rule('ASK', 'run_command', 'terragrunt destroy *')]
    const cmd = 'terragrunt destroy -auto-approve'
    const callId1 = 'cl1'
    const promise1 = requestPathAccess(
      [],
      WORKDIR,
      'rules-session',
      callId1,
      'run_command',
      noOpEvent,
      'normal',
      cmd,
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation(callId1); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation(callId1)).toBe(true)
    providePathConfirmation(callId1, true, true)
    await expect(promise1).resolves.toBeUndefined()

    clearAllowedPaths('rules-session')
    expect(getSessionAllowedRules('rules-session')).toHaveLength(0)

    const callId2 = 'cl2'
    const promise2 = requestPathAccess(
      [],
      WORKDIR,
      'rules-session',
      callId2,
      'run_command',
      noOpEvent,
      'normal',
      cmd,
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation(callId2); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation(callId2)).toBe(true)
    providePathConfirmation(callId2, false)
    await expect(promise2).rejects.toMatchObject({ name: 'PathAccessDeniedError', reason: 'rule_ask' })
  })

  it('ASK rule on read_file path → allow for session → 2nd read same path: no prompt', async () => {
    const rules = [rule('ASK', 'read_file', '/tmp/**')]
    const target = '/tmp/foo.txt'
    const callId1 = 'rp1'
    const promise1 = requestPathAccess(
      [target],
      WORKDIR,
      'rules-session',
      callId1,
      'read_file',
      noOpEvent,
      'normal',
      undefined,
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation(callId1); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation(callId1)).toBe(true)
    providePathConfirmation(callId1, true, true)
    await expect(promise1).resolves.toBeUndefined()

    noOpEvent.mockClear()
    const sessionRules = [...rules, ...getSessionAllowedRules('rules-session')]
    const callId2 = 'rp2'
    await expect(
      requestPathAccess(
        [target],
        WORKDIR,
        'rules-session',
        callId2,
        'read_file',
        noOpEvent,
        'normal',
        undefined,
        false,
        sessionRules,
      ),
    ).resolves.toBeUndefined()
    expect(noOpEvent).not.toHaveBeenCalled()
  })

  it('clearAllowedPaths purges session-allowed rules (ephemeral cleanup on session delete)', async () => {
    const rules = [rule('ASK', 'run_command', 'terragrunt destroy *')]
    const cmd = 'terragrunt destroy /tmp/x'
    const callId = 'purge-1'
    const promise = requestPathAccess(
      [],
      WORKDIR,
      'rules-session',
      callId,
      'run_command',
      noOpEvent,
      'normal',
      cmd,
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation(callId); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    providePathConfirmation(callId, true, true)
    await expect(promise).resolves.toBeUndefined()
    expect(getSessionAllowedRules('rules-session')).toHaveLength(1)

    clearAllowedPaths('rules-session')

    expect(getSessionAllowedRules('rules-session')).toHaveLength(0)

    // After purge, the same command re-prompts (no lingering ALLOW)
    const callId2 = 'purge-2'
    const promise2 = requestPathAccess(
      [],
      WORKDIR,
      'rules-session',
      callId2,
      'run_command',
      noOpEvent,
      'normal',
      cmd,
      false,
      rules,
    )
    for (let i = 0; i < 20 && !hasPendingPathConfirmation(callId2); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(hasPendingPathConfirmation(callId2)).toBe(true)
    providePathConfirmation(callId2, false)
    await expect(promise2).rejects.toMatchObject({ name: 'PathAccessDeniedError', reason: 'rule_ask' })
  })
})
