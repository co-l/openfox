import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PluginRegistry } from './registry.js'
import { setPluginThinkingGuards, clearPluginThinkingGuards, evaluateThinkingGuards } from './thinking-guards.js'
import type { PluginThinkingGuard } from '../../plugin/index.js'

describe('Plugin Thinking Guards', () => {
  beforeEach(() => {
    clearPluginThinkingGuards()
  })

  it('registers a thinking guard on PluginRegistry', () => {
    const registry = new PluginRegistry({ mode: 'development', configDirectory: '/tmp' })
    registry.beginPlugin('test-guard-plugin', {
      id: 'test-guard-plugin',
      version: '1.0.0',
      runtime: { mode: 'development', configDirectory: '/tmp' },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      storage: { get: vi.fn(), set: vi.fn() },
      settings: vi.fn().mockReturnValue({}),
      notify: vi.fn(),
      publish: vi.fn(),
    })

    const customGuard: PluginThinkingGuard = {
      id: 'loop-guard',
      evaluateThinking: vi.fn().mockReturnValue(null),
    }

    registry.registerThinkingGuard(customGuard)
    registry.endPlugin()

    const summary = registry.getContributionSummary('test-guard-plugin')
    expect(summary.thinkingGuards).toBe(1)

    const guards = registry.getThinkingGuards()
    expect(guards).toHaveLength(1)
    expect(guards[0]?.guard.id).toBe('loop-guard')
    expect(guards[0]?.pluginId).toBe('test-guard-plugin')
  })

  it('evaluates thinking guards and returns match when abort requested', () => {
    const mockGuard: PluginThinkingGuard = {
      id: 'test-guard',
      evaluateThinking: (accumulated, _delta, _ctx) => {
        if (accumulated.includes('repetitive thought')) {
          return {
            action: 'abort',
            repeatedText: 'repetitive thought',
            count: 3,
            message: 'You are looping in your thoughts!',
          }
        }
        return { action: 'continue' }
      },
    }

    setPluginThinkingGuards([{ pluginId: 'test-plugin', guard: mockGuard }])

    const matchNormal = evaluateThinkingGuards('normal thought', 'thought', {
      sessionId: 'sess-1',
      messageId: 'msg-1',
      model: 'test-model',
    })
    expect(matchNormal).toBeNull()

    const matchLoop = evaluateThinkingGuards('repetitive thought repetitive thought', 'thought', {
      sessionId: 'sess-1',
      messageId: 'msg-1',
      model: 'test-model',
    })
    expect(matchLoop).not.toBeNull()
    expect(matchLoop?.action).toBe('abort')
    expect(matchLoop?.guardId).toBe('test-guard')
    expect(matchLoop?.pluginId).toBe('test-plugin')
    expect(matchLoop?.repeatedText).toBe('repetitive thought')
    expect(matchLoop?.message).toBe('You are looping in your thoughts!')
  })

  it('handles guard exceptions gracefully with fail-open behavior', () => {
    const buggyGuard: PluginThinkingGuard = {
      id: 'buggy-guard',
      evaluateThinking: () => {
        throw new Error('Guard exploded')
      },
    }

    setPluginThinkingGuards([{ pluginId: 'buggy-plugin', guard: buggyGuard }])

    const result = evaluateThinkingGuards('any thinking', 'delta', {
      sessionId: 'sess-1',
      messageId: 'msg-1',
      model: 'test-model',
    })
    expect(result).toBeNull()
  })
})
