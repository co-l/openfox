import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  setPluginApprovalReviewers,
  clearPluginApprovalReviewers,
  evaluatePluginApproval,
  listPluginApprovalReviewers,
} from './approval-reviewers.js'
import type { PluginApprovalContext } from '../../plugin/index.js'

const CONTEXT: PluginApprovalContext = {
  kind: 'path',
  sessionId: 's1',
  workdir: '/w',
  tool: 'read_file',
  paths: ['/etc/passwd'],
  reason: 'outside_workdir',
}

describe('approval reviewers registry', () => {
  beforeEach(() => {
    clearPluginApprovalReviewers()
  })

  afterEach(() => {
    clearPluginApprovalReviewers()
  })

  it('returns undefined when no reviewer is registered (native flow unchanged)', async () => {
    expect(await evaluatePluginApproval(CONTEXT)).toBeUndefined()
  })

  it('registers and evaluates a reviewer', async () => {
    setPluginApprovalReviewers([{ pluginId: 'p', reviewer: { id: 'jev', evaluate: () => ({ action: 'allow' }) } }])
    expect(listPluginApprovalReviewers()).toHaveLength(1)
    expect(await evaluatePluginApproval(CONTEXT)).toEqual({ action: 'allow' })
  })

  it('returns undefined when a reviewer throws (fail-closed to native ask)', async () => {
    setPluginApprovalReviewers([
      {
        pluginId: 'p',
        reviewer: {
          id: 'jev',
          evaluate: () => {
            throw new Error('backend down')
          },
        },
      },
    ])
    expect(await evaluatePluginApproval(CONTEXT)).toBeUndefined()
  })

  it('returns undefined on timeout (fail-closed to native ask)', async () => {
    setPluginApprovalReviewers([
      {
        pluginId: 'p',
        reviewer: { id: 'jev', evaluate: () => new Promise(() => {}) },
      },
    ])
    expect(await evaluatePluginApproval(CONTEXT, 20)).toBeUndefined()
  })

  it('returns undefined for unrecognized decisions', async () => {
    setPluginApprovalReviewers([
      { pluginId: 'p', reviewer: { id: 'jev', evaluate: () => ({ action: 'maybe' }) as never } },
    ])
    expect(await evaluatePluginApproval(CONTEXT)).toBeUndefined()
  })

  it('combines multiple reviewers with strictest-wins semantics', async () => {
    setPluginApprovalReviewers([
      { pluginId: 'a', reviewer: { id: 'allow-all', evaluate: () => ({ action: 'allow' }) } },
      { pluginId: 'b', reviewer: { id: 'deny-all', evaluate: () => ({ action: 'deny', reason: 'no' }) } },
    ])
    expect(await evaluatePluginApproval(CONTEXT)).toEqual({ action: 'deny', reason: 'no' })
  })

  it('a failing reviewer does not mask another reviewer decision', async () => {
    setPluginApprovalReviewers([
      {
        pluginId: 'a',
        reviewer: {
          id: 'broken',
          evaluate: () => Promise.reject(new Error('boom')),
        },
      },
      { pluginId: 'b', reviewer: { id: 'ok', evaluate: () => ({ action: 'ask' }) } },
    ])
    expect(await evaluatePluginApproval(CONTEXT)).toEqual({ action: 'ask' })
  })

  it('passes the context through unchanged', async () => {
    const evaluate = vi.fn().mockReturnValue({ action: 'ask' })
    setPluginApprovalReviewers([{ pluginId: 'p', reviewer: { id: 'jev', evaluate } }])
    await evaluatePluginApproval(CONTEXT)
    expect(evaluate).toHaveBeenCalledWith(CONTEXT)
  })

  it('a late rejection after timeout does not surface as an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      setPluginApprovalReviewers([
        {
          pluginId: 'p',
          reviewer: {
            id: 'jev',
            evaluate: () =>
              new Promise((_, reject) => {
                setTimeout(() => reject(new Error('late backend failure')), 30)
              }),
          },
        },
      ])
      expect(await evaluatePluginApproval(CONTEXT, 5)).toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
