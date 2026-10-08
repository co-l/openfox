import type { PluginThinkingGuard, PluginThinkingGuardContext, PluginThinkingGuardResult } from '../../plugin/index.js'
import { logger } from '../utils/logger.js'

export interface OwnedPluginThinkingGuard {
  pluginId: string
  guard: PluginThinkingGuard
}

export interface PluginThinkingGuardMatch extends PluginThinkingGuardResult {
  guardId: string
  pluginId: string
}

let thinkingGuards: OwnedPluginThinkingGuard[] = []

export function setPluginThinkingGuards(next: OwnedPluginThinkingGuard[]): void {
  thinkingGuards = [...next]
}

export function listPluginThinkingGuards(): OwnedPluginThinkingGuard[] {
  return [...thinkingGuards]
}

export function clearPluginThinkingGuards(): void {
  thinkingGuards = []
}

export function evaluateThinkingGuards(
  accumulatedThinking: string,
  delta: string,
  context: PluginThinkingGuardContext,
): PluginThinkingGuardMatch | null {
  for (const { pluginId, guard } of thinkingGuards) {
    try {
      const result = guard.evaluateThinking(accumulatedThinking, delta, context)
      if (result && result.action === 'abort') {
        return {
          ...result,
          guardId: guard.id,
          pluginId,
        }
      }
    } catch (error) {
      logger.warn('Plugin thinking guard evaluateThinking failed', {
        pluginId,
        guardId: guard.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return null
}
