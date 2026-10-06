import type { PluginVcsContext, PluginVcsDiffFile, PluginVcsProvider } from '../../plugin/index.js'
import { logger } from '../utils/logger.js'

export interface OwnedPluginVcsProvider {
  pluginId: string
  provider: PluginVcsProvider
}

let providers: OwnedPluginVcsProvider[] = []

export function setPluginVcsProviders(next: OwnedPluginVcsProvider[]): void {
  providers = [...next].sort((a, b) => (a.provider.priority ?? 100) - (b.provider.priority ?? 100))
}

export function listPluginVcsProviders(): OwnedPluginVcsProvider[] {
  return [...providers]
}

export function clearPluginVcsProviders(): void {
  providers = []
}

const DEFAULT_VCS_TIMEOUT_MS = 5000

async function executeWithTimeout<T>(fn: () => Promise<T> | T, timeoutMs: number, errorMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(errorMessage))
    }, timeoutMs)
    timer.unref?.()
  })

  try {
    return await Promise.race([Promise.resolve(fn()), timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function findActiveVcsProvider(
  context: PluginVcsContext,
  options?: { timeoutMs?: number },
): Promise<PluginVcsProvider | null> {
  if (providers.length === 0) return null

  const timeoutMs = options?.timeoutMs ?? DEFAULT_VCS_TIMEOUT_MS

  for (const { pluginId, provider } of providers) {
    try {
      const isMatch = await executeWithTimeout(
        () => provider.detect(context),
        timeoutMs,
        `VCS provider '${provider.id}' from plugin '${pluginId}' timed out on detect() after ${timeoutMs}ms`,
      )
      if (isMatch) {
        return provider
      }
    } catch (error) {
      logger.warn(`VCS provider '${provider.id}' from plugin '${pluginId}' failed detect()`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return null
}

export async function resolveVcsDiffFiles(
  context: PluginVcsContext,
  options?: { timeoutMs?: number },
): Promise<PluginVcsDiffFile[] | null> {
  const provider = await findActiveVcsProvider(context, options)
  if (!provider) return null

  const timeoutMs = options?.timeoutMs ?? DEFAULT_VCS_TIMEOUT_MS
  try {
    return await executeWithTimeout(
      () => provider.getDiffFiles(context),
      timeoutMs,
      `VCS provider '${provider.id}' timed out on getDiffFiles() after ${timeoutMs}ms`,
    )
  } catch (error) {
    logger.warn(`VCS provider '${provider.id}' failed getDiffFiles()`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function resolveVcsBranch(
  context: PluginVcsContext,
  options?: { timeoutMs?: number },
): Promise<string | null | undefined> {
  const provider = await findActiveVcsProvider(context, options)
  if (!provider || typeof provider.getBranch !== 'function') return undefined

  const timeoutMs = options?.timeoutMs ?? DEFAULT_VCS_TIMEOUT_MS
  try {
    return await executeWithTimeout(
      () => provider.getBranch!(context),
      timeoutMs,
      `VCS provider '${provider.id}' timed out on getBranch() after ${timeoutMs}ms`,
    )
  } catch (error) {
    logger.warn(`VCS provider '${provider.id}' failed getBranch()`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

export async function resolveVcsModifiedFiles(
  context: PluginVcsContext,
  options?: { timeoutMs?: number },
): Promise<string | null> {
  const provider = await findActiveVcsProvider(context, options)
  if (!provider) return null

  const timeoutMs = options?.timeoutMs ?? DEFAULT_VCS_TIMEOUT_MS
  try {
    const diffFiles = await executeWithTimeout(
      () => provider.getDiffFiles(context),
      timeoutMs,
      `VCS provider '${provider.id}' timed out on getDiffFiles() after ${timeoutMs}ms`,
    )

    if (typeof provider.formatModifiedFiles === 'function') {
      return await executeWithTimeout(
        () => provider.formatModifiedFiles!(diffFiles, context),
        timeoutMs,
        `VCS provider '${provider.id}' timed out on formatModifiedFiles() after ${timeoutMs}ms`,
      )
    }

    if (!diffFiles || diffFiles.length === 0) return '(none)'
    return diffFiles.map((f) => `- ${f.path} (${f.status})`).join('\n')
  } catch (error) {
    logger.warn(`VCS provider '${provider.id}' failed resolveVcsModifiedFiles()`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
