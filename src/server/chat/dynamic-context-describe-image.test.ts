import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getEffectiveToolDefinitions, getToolSetFingerprint } from './dynamic-context.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { AgentDefinition } from '../agents/types.js'
import type { ToolRegistry } from '../tools/types.js'

vi.mock('../tools/index.js', () => ({
  getToolRegistryForAgent: vi.fn(),
}))
vi.mock('../tools/describe-image.js', () => ({
  isDescribeImageEligible: vi.fn(),
}))

import { getToolRegistryForAgent } from '../tools/index.js'
import { isDescribeImageEligible } from '../tools/describe-image.js'

function def(name: string): LLMToolDefinition {
  return { type: 'function', function: { name, description: '', parameters: {} } }
}

const baseDefs = [def('read_file'), def('describe_image'), def('write_file')]

function fakeRegistry(): ToolRegistry {
  return {
    tools: [],
    definitions: baseDefs,
    execute: async () => ({ success: true, durationMs: 0, truncated: false }) as never,
  }
}

const agentDef = { metadata: { id: 'builder', subagent: false, allowedTools: [] } } as unknown as AgentDefinition

describe('getEffectiveToolDefinitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getToolRegistryForAgent).mockReturnValue(fakeRegistry())
  })

  it('keeps describe_image when eligible', async () => {
    vi.mocked(isDescribeImageEligible).mockResolvedValue(true)
    const result = await getEffectiveToolDefinitions(agentDef, 'sess', 'llama3')
    expect(result.map((d) => d.function.name)).toEqual(['read_file', 'describe_image', 'write_file'])
  })

  it('removes describe_image when not eligible', async () => {
    vi.mocked(isDescribeImageEligible).mockResolvedValue(false)
    const result = await getEffectiveToolDefinitions(agentDef, 'sess', 'llama3')
    expect(result.map((d) => d.function.name)).toEqual(['read_file', 'write_file'])
  })

  it('passes the model name through to the eligibility check', async () => {
    vi.mocked(isDescribeImageEligible).mockResolvedValue(true)
    await getEffectiveToolDefinitions(agentDef, 'sess', 'llama3')
    expect(isDescribeImageEligible).toHaveBeenCalledWith('llama3')
  })

  it('changes the tool-set fingerprint when eligibility flips (drives drift reminders)', async () => {
    // buildCachedPrompt, computeSessionHash and drift detection all hash this
    // tool set, so eligibility must move the fingerprint — that is what makes
    // a vision<->non-vision model switch announce the tool as added/removed.
    vi.mocked(isDescribeImageEligible).mockResolvedValue(true)
    const eligibleFingerprint = getToolSetFingerprint(await getEffectiveToolDefinitions(agentDef, 'sess', 'llama3'))

    vi.mocked(isDescribeImageEligible).mockResolvedValue(false)
    const ineligibleFingerprint = getToolSetFingerprint(await getEffectiveToolDefinitions(agentDef, 'sess', 'llama3'))

    expect(eligibleFingerprint).not.toBe(ineligibleFingerprint)
    expect(ineligibleFingerprint).toBe(
      getToolSetFingerprint(baseDefs.filter((d) => d.function.name !== 'describe_image')),
    )
  })
})
