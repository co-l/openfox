import type { PluginHookEvent, PluginHookPayload } from '../../plugin/index.js'
import type { PluginRegistry } from './registry.js'
import { withTimeout } from './with-timeout.js'

export interface HookLogger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

export const DEFAULT_HOOK_TIMEOUT_MS = 5000

export class HookBus {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly logger: HookLogger,
    private readonly timeoutMs: number = DEFAULT_HOOK_TIMEOUT_MS,
  ) {}

  async emit(event: PluginHookEvent, payload: Omit<PluginHookPayload, 'event' | 'timestamp'>): Promise<void> {
    const handlers = this.registry.getHookHandlers(event)
    if (handlers.length === 0) return
    const full: PluginHookPayload = { event, timestamp: new Date().toISOString(), ...payload }

    await Promise.all(
      handlers.map(async ({ pluginId, value }) => {
        try {
          await withTimeout(Promise.resolve(value(full)), this.timeoutMs, 'Hook')
        } catch (error) {
          this.logger.warn('Plugin hook failed', {
            pluginId,
            event,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }),
    )
  }
}
