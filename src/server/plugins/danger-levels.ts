import type { PluginDangerLevel, PluginPathAccessContext, PluginPathAccessDecision } from '../../plugin/index.js'
import { logger } from '../utils/logger.js'

export interface OwnedPluginDangerLevel {
  pluginId: string
  dangerLevel: PluginDangerLevel
}

let dangerLevels: OwnedPluginDangerLevel[] = []

export function setPluginDangerLevels(next: OwnedPluginDangerLevel[]): void {
  dangerLevels = [...next]
}

export function listPluginDangerLevels(): OwnedPluginDangerLevel[] {
  return [...dangerLevels]
}

export function getPluginDangerLevel(id: string): OwnedPluginDangerLevel | undefined {
  return dangerLevels.find((entry) => entry.dangerLevel.id === id)
}

export function clearPluginDangerLevels(): void {
  dangerLevels = []
}

export async function evaluatePluginPathAccess(
  dangerLevelId: string,
  context: PluginPathAccessContext,
): Promise<PluginPathAccessDecision | undefined> {
  const owned = getPluginDangerLevel(dangerLevelId)
  if (!owned || !owned.dangerLevel.evaluatePathAccess) return undefined
  try {
    return await owned.dangerLevel.evaluatePathAccess(context)
  } catch (error) {
    logger.warn('Plugin danger level evaluatePathAccess failed', {
      pluginId: owned.pluginId,
      dangerLevel: dangerLevelId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
