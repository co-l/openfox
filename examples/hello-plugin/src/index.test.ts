import { describe, expect, it, vi } from 'vitest'
import { register } from './index.js'

function createRegistry() {
  const calls = {}
  const record = (key) => (value) => {
    calls[key] = [...(calls[key] ?? []), value]
  }
  const registry = {
    runtime: { mode: 'production', configDirectory: '/tmp' },
    context: {
      id: 'openfox-hello-plugin',
      version: '1.0.0',
      runtime: { mode: 'production', configDirectory: '/tmp' },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      storage: { get: () => undefined, set: vi.fn() },
      settings: () => ({ greeting: 'Hi' }),
      notify: vi.fn(),
      publish: vi.fn(),
    },
    registerAuth: record('auth'),
    registerTransport: record('transport'),
    registerPreset: record('preset'),
    registerModelMetadataProvider: record('modelMetadata'),
    registerTool: record('tool'),
    registerCommand: record('command'),
    registerSkillSource: record('skillSource'),
    registerSettings: record('settings'),
    registerUiAction: record('uiAction'),
    registerUiBadge: record('uiBadge'),
    registerUiPanel: record('uiPanel'),
    registerHook: (event, handler) => record(`hook:${event}`)(handler),
    registerTransitionHandler: (name, handler) => record(`transition:${name}`)(handler),
    registerRpc: (method, handler) => record(`rpc:${method}`)(handler),
    registerAsset: record('asset'),
  }
  return { registry, calls }
}

describe('hello plugin', () => {
  it('registers every documented contribution point', () => {
    const { registry, calls } = createRegistry()
    register(registry as never)

    expect(calls.tool).toHaveLength(1)
    expect(calls.command).toHaveLength(1)
    expect(calls.settings).toHaveLength(1)
    expect(calls.uiAction).toHaveLength(1)
    expect(calls.uiPanel).toHaveLength(1)
    expect(calls['rpc:notify']).toHaveLength(1)
    expect(calls['hook:turn.completed']).toHaveLength(1)
    expect(calls['transition:hello_plugin_never']).toHaveLength(1)
  })

  it('greets with the configured setting', async () => {
    const { registry, calls } = createRegistry()
    register(registry as never)
    const tool = calls.tool[0]
    const result = await tool.execute({ name: 'Conrad' })
    expect(result).toEqual({ success: true, output: 'Hi, Conrad!' })
  })

  it('emits a notification from the RPC method', async () => {
    const { registry, calls } = createRegistry()
    register(registry as never)
    const handler = calls['rpc:notify'][0]
    await expect(handler()).resolves.toBe('ok')
    expect(registry.context.notify).toHaveBeenCalled()
    expect(registry.context.publish).toHaveBeenCalledWith('hello-panel', 'greeting', 'Hi')
  })
})
