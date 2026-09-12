// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StatsModal } from './StatsModal'
import type { SessionStats } from '@shared/types.js'

vi.mock('../../hooks/useAgents', () => ({
  useAgents: () => ({
    agents: [
      { id: 'builder', name: 'Builder', color: '#3b82f6', subagent: false, allowedTools: [] },
      { id: 'code_reviewer', name: 'Code Reviewer', color: '#10b981', subagent: true, allowedTools: [] },
      { id: 'verifier', name: 'Verifier', color: '#8b5cf6', subagent: true, allowedTools: [] },
      { id: 'planner', name: 'Planner', color: '#a855f7', subagent: false, allowedTools: [] },
    ],
    refresh: vi.fn(),
  }),
}))

const mockMultiModelStats: SessionStats = {
  totalTime: 40,
  aiTime: 36,
  toolTime: 4,
  prefillTokens: 120000,
  generationTokens: 1400,
  avgPrefillSpeed: 2100,
  avgGenerationSpeed: 400,
  responseCount: 2,
  llmCallCount: 20,
  dataPoints: [],
  callDataPoints: [],
  modelGroups: [
    {
      key: 'antigravity::gemini-3.7-flash-medium',
      label: 'Antigravity > gemini-3.7-flash-medium',
      providerId: 'antigravity',
      providerName: 'Antigravity',
      backend: 'vllm',
      model: 'gemini-3.7-flash-medium',
      totalTime: 2,
      aiTime: 2,
      toolTime: 0,
      prefillTokens: 5800,
      generationTokens: 200,
      avgPrefillSpeed: 2000,
      avgGenerationSpeed: 100,
      responseCount: 1,
      llmCallCount: 1,
      dataPoints: [],
      callDataPoints: [],
      agentGroups: [
        {
          agentId: 'planner',
          isSubAgent: false,
          totalTime: 2,
          aiTime: 2,
          toolTime: 0,
          prefillTokens: 5800,
          generationTokens: 200,
          avgPrefillSpeed: 2000,
          avgGenerationSpeed: 100,
          responseCount: 1,
          llmCallCount: 1,
          dataPoints: [],
          callDataPoints: [],
        },
      ],
    },
    {
      key: 'antigravity::gemini-3.7-flash',
      label: 'Antigravity > gemini-3.7-flash',
      providerId: 'antigravity',
      providerName: 'Antigravity',
      backend: 'vllm',
      model: 'gemini-3.7-flash',
      totalTime: 38,
      aiTime: 34,
      toolTime: 4,
      prefillTokens: 114200,
      generationTokens: 1200,
      avgPrefillSpeed: 2100,
      avgGenerationSpeed: 480,
      responseCount: 1,
      llmCallCount: 19,
      dataPoints: [],
      callDataPoints: [],
      agentGroups: [
        {
          agentId: 'code_reviewer',
          isSubAgent: true,
          totalTime: 38,
          aiTime: 34,
          toolTime: 4,
          prefillTokens: 114200,
          generationTokens: 1200,
          avgPrefillSpeed: 2100,
          avgGenerationSpeed: 480,
          responseCount: 1,
          llmCallCount: 19,
          dataPoints: [],
          callDataPoints: [],
        },
      ],
    },
  ],
  agentGroups: [
    {
      agentId: 'planner',
      isSubAgent: false,
      totalTime: 2,
      aiTime: 2,
      toolTime: 0,
      prefillTokens: 5800,
      generationTokens: 200,
      avgPrefillSpeed: 2000,
      avgGenerationSpeed: 100,
      responseCount: 1,
      llmCallCount: 1,
      dataPoints: [],
      callDataPoints: [],
    },
    {
      agentId: 'code_reviewer',
      isSubAgent: true,
      totalTime: 38,
      aiTime: 34,
      toolTime: 4,
      prefillTokens: 114200,
      generationTokens: 1200,
      avgPrefillSpeed: 2100,
      avgGenerationSpeed: 480,
      responseCount: 1,
      llmCallCount: 19,
      dataPoints: [],
      callDataPoints: [],
    },
  ],
}

describe('StatsModal', () => {
  it('renders "All Models" tab by default when multiple models are present', () => {
    render(<StatsModal isOpen={true} onClose={vi.fn()} stats={mockMultiModelStats} />)

    expect(screen.getByText('Session Stats')).toBeDefined()
    expect(screen.getByText('All Models')).toBeDefined()
    expect(screen.getByText('Antigravity > gemini-3.7-flash-medium')).toBeDefined()
    expect(screen.getByText('Antigravity > gemini-3.7-flash')).toBeDefined()

    // Both planner and sub-agent code_reviewer should be visible in the merged view
    expect(screen.getByText('Planner')).toBeDefined()
    expect(screen.getByText('Code Reviewer')).toBeDefined()
    expect(screen.getByText('114.2k')).toBeDefined()
    expect(screen.getByText('5.8k')).toBeDefined()
  })

  it('filters by model when a specific model tab is clicked', () => {
    render(<StatsModal isOpen={true} onClose={vi.fn()} stats={mockMultiModelStats} />)

    const flashModelButton = screen.getByText('Antigravity > gemini-3.7-flash')
    fireEvent.click(flashModelButton)

    // In flash model view, only code_reviewer was used
    expect(screen.getByText('Code Reviewer')).toBeDefined()
    expect(screen.queryByText('Planner')).toBeNull()

    const mediumModelButton = screen.getByText('Antigravity > gemini-3.7-flash-medium')
    fireEvent.click(mediumModelButton)

    // In flash-medium model view, only planner was used
    expect(screen.getByText('Planner')).toBeDefined()
    expect(screen.queryByText('Code Reviewer')).toBeNull()

    // Click back to All Models
    const allModelsButton = screen.getByText('All Models')
    fireEvent.click(allModelsButton)

    expect(screen.getByText('Planner')).toBeDefined()
    expect(screen.getByText('Code Reviewer')).toBeDefined()
  })
})
