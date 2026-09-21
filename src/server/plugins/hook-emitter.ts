import type { PluginHookEvent, PluginHookPayload } from '../../plugin/index.js'

type HookEmitter = (event: PluginHookEvent, payload: Omit<PluginHookPayload, 'event' | 'timestamp'>) => void

let emitter: HookEmitter | undefined

export function setPluginHookEmitter(next: HookEmitter | undefined): void {
  emitter = next
}

/** Fire-and-forget hook emission; no-op when no plugin host is attached. */
export function emitPluginHook(event: PluginHookEvent, payload: Omit<PluginHookPayload, 'event' | 'timestamp'>): void {
  emitter?.(event, payload)
}
