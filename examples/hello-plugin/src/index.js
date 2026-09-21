/**
 * Reference OpenFox plugin.
 *
 * Plain ESM with JSDoc types so it runs without a build step, while still
 * type-checking against the real `openfox/plugin` contract (`npm run build`).
 *
 * @typedef {import('openfox/plugin').PluginRegistry} PluginRegistry
 */

/**
 * @type {import('openfox/plugin').PluginSettingsSchema}
 */
const SETTINGS = {
  fields: [
    {
      key: 'greeting',
      type: 'text',
      label: { en: 'Greeting', fr: 'Salutation' },
      description: { en: 'Returned by the hello tool.', fr: 'Renvoyé par l’outil hello.' },
      default: 'Hello from a plugin',
    },
    {
      key: 'apiToken',
      type: 'password',
      label: { en: 'API token', fr: 'Jeton d’API' },
      secret: true,
    },
  ],
}

/**
 * @param {PluginRegistry} registry
 */
export function register(registry) {
  const { context } = registry

  registry.registerTool({
    name: 'hello_plugin_greet',
    description: 'Return the configured greeting.',
    parameters: { type: 'object', properties: { name: { type: 'string' } } },
    execute: async (args) => {
      const greeting = context.settings().greeting ?? 'Hello'
      const name = typeof args.name === 'string' ? args.name : 'world'
      return { success: true, output: `${greeting}, ${name}!` }
    },
  })

  registry.registerCommand({
    id: 'hello-plugin',
    name: 'Hello plugin',
    prompt: 'Say hello using the hello_plugin_greet tool.',
  })

  registry.registerSettings(SETTINGS)

  registry.registerUiAction({
    id: 'hello-open-panel',
    slot: 'header.actions',
    label: { en: 'Hello plugin', fr: 'Plugin Hello' },
    icon: 'puzzle',
    onActivate: { kind: 'openPanel', panelId: 'hello-panel' },
  })

  registry.registerUiPanel({
    id: 'hello-panel',
    title: { en: 'Hello plugin', fr: 'Plugin Hello' },
    size: 'sm',
    kind: 'declarative',
    content: [
      { type: 'text', text: { en: 'This panel is rendered by the host.', fr: 'Ce panneau est rendu par l’hôte.' } },
      { type: 'keyValue', items: [{ key: { en: 'Greeting', fr: 'Salutation' }, value: '{{greeting}}' }] },
      {
        type: 'button',
        label: { en: 'Notify me', fr: 'Me notifier' },
        onActivate: { kind: 'rpc', method: 'notify' },
      },
    ],
  })

  registry.registerRpc('notify', async () => {
    context.notify({
      title: { en: 'Hello plugin', fr: 'Plugin Hello' },
      body: { en: 'RPC method invoked.', fr: 'Méthode RPC appelée.' },
      level: 'success',
    })
    context.publish('hello-panel', 'greeting', String(context.settings().greeting ?? ''))
    return 'ok'
  })

  registry.registerHook('turn.completed', (payload) => {
    context.logger.info('Turn completed', { sessionId: payload.sessionId })
  })

  registry.registerTransitionHandler('hello_plugin_never', () => false)
}
