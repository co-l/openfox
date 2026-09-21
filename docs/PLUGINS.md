# OpenFox Plugins

Plugins let you extend OpenFox without forking it: new LLM providers, tools,
slash commands, skills, workflow transitions, settings, notifications, and
declarative UI (actions, badges, panels) — all declared through one versioned
contract, `openfox/plugin`.

The core stays in control: plugins can only _contribute_ through the registry.
They cannot patch internals, and every contribution is namespaced by plugin id,
validated on load, and introspectable from the Plugins settings tab.

- Working example: [`examples/hello-plugin`](../examples/hello-plugin)
- Public contract source: [`src/plugin/index.ts`](../src/plugin/index.ts)
- Shared descriptor types: [`src/shared/plugin.ts`](../src/shared/plugin.ts)
- Host internals and lifecycle: [`docs/PLUGIN-ARCHITECTURE.md`](PLUGIN-ARCHITECTURE.md)

---

## 1. Concepts

| Piece           | What it is                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| **Manifest**    | `openfox` field in your `package.json`: API version, entry point, display name, capabilities               |
| **Entry point** | ESM module exporting `register(registry)` (and optional `deactivate()`)                                    |
| **Registry**    | The object passed to `register()`. Every contribution is a method on it                                    |
| **Context**     | `registry.context`: logger, per-plugin storage, settings reader, `notify()`, `publish()`                   |
| **Host**        | The server-side runtime that loads plugins, validates them, isolates failures, and exposes state to the UI |

### Trust model

Plugins run **in-process with full Node.js privileges**, exactly like the
provider plugins that came before them. There is no sandbox.

- Install only plugins you trust.
- The curated `plugins-registry.json` list is maintained in the OpenFox repo;
  arbitrary GitHub URLs, npm packages, and local paths are also accepted.
- The manifest `capabilities` array is **declarative**: the Plugins tab shows it
  before/after install so users can see what a plugin intends to do.
- Project-local plugin _code_ (`.openfox/plugins/`) is deliberately **not**
  loaded: cloning a repository must never execute code. Plugin _settings_ can
  still be project-scoped.

If you need isolation, run untrusted logic in your own process and call it from
the plugin — the host only ever invokes your `register`/RPC/hook functions.

---

## 2. Quick start

```
openfox-hello-plugin/
├── package.json
└── src/index.js
```

```json
{
  "name": "openfox-hello-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.js",
  "openfox": {
    "apiVersion": 2,
    "entry": "./src/index.js",
    "displayName": "Hello Plugin",
    "description": "Adds a hello tool and a header button.",
    "capabilities": ["tools", "ui"],
    "timeoutMs": 15000
  }
}
```

```js
import type { PluginRegistry } from 'openfox/plugin'

export function register(registry: PluginRegistry) {
  registry.registerTool({
    name: 'hello_greet',
    description: 'Return a greeting.',
    parameters: { type: 'object', properties: { name: { type: 'string' } } },
    execute: async (args) => ({ success: true, output: `Hello, ${args.name ?? 'world'}!` }),
  })

  registry.registerUiAction({
    id: 'hello-open',
    slot: 'header.actions',
    label: { en: 'Say hello', fr: 'Dire bonjour' },
    icon: 'puzzle',
    onActivate: { kind: 'rpc', method: 'greet' },
  })

  registry.registerRpc('greet', async () => {
    registry.context.notify({
      title: { en: 'Hello!', fr: 'Bonjour !' },
      level: 'success',
    })
    return 'ok'
  })
}
```

Install it from **Settings → Plugins** (GitHub URL, npm package name, or a local
path), enable it, and the tool appears in the agent tool list, the action in the
header.

### Manifest reference

| Field                  | Required   | Description                                                                                                                    |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `openfox.apiVersion`   | yes        | `1` (providers only, legacy) or `2` (full plugin API)                                                                          |
| `openfox.entry`        | yes for v2 | Path to the ESM entry point, relative to the package root. `openfox.plugin` is accepted for v1 packages                        |
| `openfox.displayName`  | no         | Shown in the Plugins tab. Defaults to the package name                                                                         |
| `openfox.description`  | no         | Shown in the Plugins tab                                                                                                       |
| `openfox.capabilities` | no         | `providers`, `models`, `settings`, `tools`, `commands`, `skills`, `ui`, `hooks`, `notifications`, `workflows`, `rpc`, `assets` |
| `openfox.timeoutMs`    | no         | Per-plugin RPC timeout in ms (default 30 000)                                                                                  |

### Discovery and lifecycle

Roots are scanned in order, deduplicated by package name:

1. `{configDir}/plugins/<name>`
2. `{configDir}/plugins/node_modules/<name>` (npm-installed plugins)
3. `{cwd}/node_modules/<name>`

`configDir` is `~/.config/openfox/` in production and `~/.config/openfox-dev/`
in development. Plugins can be installed, enabled, disabled, and uninstalled at
runtime from the Plugins tab — no server restart. Disabling removes every
contribution and calls your optional `deactivate()`; re-enabling re-imports the
module.

A plugin that throws during `register()` is reported as a diagnostic (red status
in the Plugins tab) and never blocks other plugins or the server.

---

## 3. Contribution reference

### Providers (`providers`)

Same contract as API v1, unchanged:

```ts
registry.registerAuth(adapter) // ProviderAuthAdapter
registry.registerTransport(adapter) // ProviderTransportAdapter
registry.registerPreset(preset) // ProviderPreset
```

See [`docs/PROVIDER-PLUGINS.md`](./PROVIDER-PLUGINS.md) for the full provider
adapter reference. Existing v1 plugins keep working untouched.

### Model metadata (`models`)

```ts
registry.registerModelMetadataProvider({
  id: 'pricing',
  getMetadata: ({ providerId, modelId, model }) => ({
    pricing: { input: 0.15, output: 0.6, currency: 'USD', discountPercent: 20 },
    contextWindow: 200_000,
    vision: true,
    badges: [{ label: { en: 'Cheap', fr: 'Économique' }, tone: 'success' }],
  }),
})
```

Metadata is merged into the provider listing returned by `/api/providers`
without mutating persisted configuration, and surfaces in the model picker
(price line, capability badge). Return `undefined` for models you don't cover.

### Tools (`tools`)

```ts
registry.registerTool({
  name: 'my_tool',
  description: 'Shown to the LLM.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  execute: async (args, context) => ({ success: true, output: '...' }),
})
```

- `name` must be unique; built-in tool names (`read_file`, `run_command`, …)
  cannot be shadowed — the plugin is rejected with a diagnostic.
- Plugin tools appear in **Settings → Tools** and must be listed in an agent's
  `allowedTools` to be callable.
- `context` is `{ sessionId, workdir, projectId?, signal? }`.
- Return `{ success, output?, error? }`; thrown errors become failed tool results.

### Commands (`commands`)

```ts
registry.registerCommand({ id: 'review', name: 'Review', prompt: 'Review {{file}}', agentMode: 'builder' })
```

Plugin commands merge into the slash-command registry (plugin commands win over
defaults with the same id) and carry provenance: `/api/commands` includes a
`pluginId` field on the command, and the Commands settings list shows a
**Plugin** tag next to it. A user command with the same id shadows the plugin
command.

### Skills (`skills`)

```ts
registry.registerSkillSource({
  id: 'team-skills',
  label: { en: 'Team skills', fr: 'Compétences d’équipe' },
  load: () => [{ id: 'deploy', name: 'Deploy', description: '…', prompt: '…' }],
})
```

`load()` is called on enable and whenever contributions change; loaded skills
join the normal skill discovery flow with `source: 'plugin'`.

### Settings (`settings`)

```ts
registry.registerSettings({
  fields: [
    { key: 'endpoint', type: 'text', label: { en: 'Endpoint', fr: 'Endpoint' }, default: 'https://api.example' },
    { key: 'token', type: 'password', label: { en: 'Token', fr: 'Jeton' }, secret: true },
    {
      key: 'mode',
      type: 'select',
      label: { en: 'Mode', fr: 'Mode' },
      options: [
        { value: 'fast', label: { en: 'Fast', fr: 'Rapide' } },
        { value: 'thorough', label: { en: 'Thorough', fr: 'Approfondi' } },
      ],
    },
  ],
})
```

- Types: `text`, `password`, `number`, `boolean`, `select`, `textarea`, `path`.
- A form is auto-rendered in the Plugins tab from the schema — you never write UI code for it.
- Values are stored per plugin in the database. `scope: 'project'` on a field
  stores it per project; otherwise the request scope applies (`global` by default).
- Secret fields (`secret: true` or `type: 'password'`) are **never returned in
  cleartext**: reads return them in a `secretsSet` list, and an empty submitted
  value keeps the stored secret.
- Read them at runtime with `context.settings(scope?, projectId?)`.

### UI (`ui`)

UI contributions are **declarative descriptors** the host renders. Plugins never
ship React code, so the contract cannot break when the web UI is refactored.
Rich custom UI is supported through sandboxed iframe panels.

**Slots**

| Slot                     | Rendered in                    |
| ------------------------ | ------------------------------ |
| `header.actions`         | Top header                     |
| `session.header.actions` | Session header                 |
| `message.actions`        | Message context menu           |
| `composer.actions`       | Chat composer, above the input |
| `session.row.badges`     | Session rows in the sidebar    |
| `session.header.badges`  | Session header                 |

Settings are not a slot: `registerSettings()` drives the schema-rendered form
that appears in the Plugins tab.

**Actions**

```ts
registry.registerUiAction({
  id: 'export',
  slot: 'message.actions',
  label: { en: 'Export message', fr: 'Exporter le message' },
  icon: 'download', // whitelisted: bell, check, download, external,
  // folder, gear, info, play, plus, puzzle,
  // refresh, search, star, terminal, trash, warning
  variant: 'default', // default | primary | danger
  tooltip: { en: '…', fr: '…' },
  visibleWhen: { hasMessage: true }, // declarative visibility, see below
  onActivate: { kind: 'rpc', method: 'export', params: { format: 'md' } },
})
```

`onActivate` kinds:

- `{ kind: 'rpc', method, params? }` — calls your RPC method with the current
  context (`sessionId`, `workdir`) attached.
- `{ kind: 'openPanel', panelId }` — opens one of your panels.
- `{ kind: 'openUrl', url }` — opens a URL in a new tab.

`visibleWhen` gates a contribution on the slot context: `hasSession`,
`hasProject`, `hasMessage`. Fields are ANDed and omitted fields impose no
constraint, so `{ hasMessage: true }` hides the action everywhere except the
message context menu. Actions and badges support it; the host filters before
rendering.

**Badges**

```ts
registry.registerUiBadge({
  id: 'quota',
  slot: 'session.row.badges',
  label: { en: 'Quota', fr: 'Quota' },
  tone: 'warning', // neutral | info | success | warning | danger
  visibleWhen: { hasSession: true }, // optional declarative visibility
  source: { kind: 'rpc', method: 'quota' }, // optional; value may also be a static string
})
```

**Panels**

```ts
registry.registerUiPanel({
  id: 'quota',
  title: { en: 'Usage & quota', fr: 'Utilisation et quota' },
  size: 'md',
  kind: 'declarative',
  content: [
    { type: 'text', text: { en: 'Live usage', fr: 'Utilisation en direct' } },
    { type: 'keyValue', items: [{ key: { en: 'Remaining', fr: 'Restant' }, value: '{{tokens}}' }] },
    { type: 'progress', label: { en: 'Budget', fr: 'Budget' }, value: 25, max: 100, tone: 'info' },
    { type: 'table', columns: [{ en: 'Model', fr: 'Modèle' }], rows: [['gpt-x']] },
    { type: 'badge', label: { en: 'Pro', fr: 'Pro' }, tone: 'info' },
    { type: 'button', label: { en: 'Refresh', fr: 'Actualiser' }, onActivate: { kind: 'rpc', method: 'refresh' } },
    { type: 'divider' },
  ],
})
```

Declarative node types: `text`, `keyValue`, `table`, `progress`, `badge`,
`button`, `divider`. String values may contain `{{key}}` placeholders filled
from values you publish with `context.publish(panelId, key, value)`; published
state arrives over WebSocket (`plugin.ui_state`) and re-renders the open panel.

Iframe panels:

```ts
registry.registerUiPanel({ id: 'board', title: { en: 'Board', fr: 'Tableau' }, kind: 'iframe', url: 'board.html' })
registry.registerAsset('board.html')
```

The iframe is served from `/api/plugins/<id>/assets/<path>` with
`sandbox="allow-scripts allow-forms"`. Only files you registered with
`registerAsset` are served. When network auth is enabled the host appends the
session token as a `?token=` query parameter (an iframe cannot send headers), so
your page can read it from `location.search` and call your RPC endpoints itself;
otherwise it can poll your RPC methods or receive `plugin.ui_state` updates by
listening on the app's WebSocket.

### Notifications (`notifications`)

```ts
context.notify({
  title: { en: 'Build finished', fr: 'Build terminé' },
  body: { en: '3 tests passed', fr: '3 tests réussis' },
  level: 'success', // info | success | warning | error
  actions: [{ label: { en: 'Open report', fr: 'Ouvrir le rapport' }, onActivate: { kind: 'rpc', method: 'report' } }],
})
```

Notifications are persisted, streamed over WebSocket, rendered as a toast, and
listed in the header bell with an unread badge. Streamed and refetched data have
identical shape. Each optional `action` renders as a button in both the toast and
the notification center and uses the same `onActivate` contract as UI actions.

### Hooks (`hooks`)

```ts
registry.registerHook('turn.completed', async (payload) => {
  await myTelemetry.record(payload.sessionId, payload.data)
})
```

Events: `session.created`, `turn.completed`, `workflow.step.completed`
(emitted when a turn ends with `step_done`), `workflow.execution.changed` (any
execution state change, including `status` and `currentStepId`),
`task.completed` (a workflow run finished), `message.created`, `tool.completed`,
`llm.completed`, `criterion.updated`.

Hooks are **observational**: they cannot block or alter the agent loop. Each
handler runs with a 5 s timeout; a throwing or slow handler is logged and
ignored, and never affects the turn.

### Workflow transitions (`workflows`)

```ts
registry.registerTransitionHandler('needs_review', async ({ config, outcome }) => {
  return config.route === 'review' && outcome?.result === 'pass'
})
```

Reference it from a workflow file:

```json
{ "when": { "type": "custom", "handler": "needs_review", "config": { "route": "review" } }, "goto": "review" }
```

The handler receives `{ workflowId, stepId, config, outcome, metadataEntries }`
and must return `true` to fire the transition. Unknown handlers and errors
return `false`, so a following `always` transition still provides a fallback.

### RPC

```ts
registry.registerRpc('quota', async (params, context) => {
  return { remaining: 1234 }
})
```

Endpoints are `POST /api/plugins/<pluginId>/rpc/<method>` (authenticated with
the same session token as the rest of the API). `params` is the JSON body's
`params`, and `context` carries `sessionId`/`workdir`. Timeouts come from
`openfox.timeoutMs` (default 30 s) and produce a structured error.

The `rpc` capability is enforced: if your manifest declares a non-empty
`capabilities` list, it must include `"rpc"` or the endpoint rejects every call
with `does not declare the 'rpc' capability`. Omitting `capabilities` entirely
keeps the endpoint available (legacy behaviour).

### Assets (`assets`)

```ts
registry.registerAsset('board.html')
```

Files are served read-only from `/api/plugins/<id>/assets/<path>`; only
registered relative paths are reachable, and path traversal is rejected.

### Context API

| Member                                 | Description                                                 |
| -------------------------------------- | ----------------------------------------------------------- |
| `context.id` / `context.version`       | Plugin package name and version                             |
| `context.runtime`                      | `{ mode, configDirectory }`                                 |
| `context.logger`                       | `debug`/`info`/`warn`/`error`, prefixed with your plugin id |
| `context.storage`                      | Small per-plugin KV store (`get`/`set`, JSON-serialized)    |
| `context.settings(scope?, projectId?)` | Resolved settings values                                    |
| `context.notify(request)`              | Emit a notification                                         |
| `context.publish(panelId, key, value)` | Publish state to your panels                                |

---

## 4. Versioning and deprecation

- `apiVersion: 2` is the current contract. Additive changes are shipped as
  minor releases and documented in `CHANGELOG.md`.
- Anything removed or changed incompatibly requires `apiVersion: 3`; v2 plugins
  keep loading until a documented removal window.
- `apiVersion: 1` (provider plugins) remains supported; only the three provider
  registration methods are available to it.
- The host rejects unknown API versions with a diagnostic instead of guessing.

### Contract utilities

The `openfox/plugin` module also exports the building blocks the host uses, so
you can validate a manifest yourself (in a CLI, CI check, or your own installer):

```ts
import { PLUGIN_API_VERSION, pluginManifestSchema } from 'openfox/plugin'

PLUGIN_API_VERSION // 2 — the version this OpenFox release implements
const result = pluginManifestSchema.safeParse(pkg)
if (!result.success) console.error(result.error.issues)
```

`pluginManifestSchema` validates the `name`/`version`/`openfox` shape (including
`apiVersion` being an integer); the host additionally rejects any `apiVersion`
other than `1` or `2` with `Unsupported OpenFox plugin API version: <n>`.

---

## 5. Testing your plugin

The registry is a plain object, so a fake registry is enough for unit tests —
see [`examples/hello-plugin/src/index.test.ts`](../examples/hello-plugin/src/index.test.ts):

```ts
const calls = {}
const registry = {
  context: {/* stubs */},
  registerTool: (tool) => {
    calls.tool = tool
  },
  // …
}
register(registry)
```

For integration testing, install the plugin into a scratch config directory and
start OpenFox with `OPENFOX_DEV=true`; the Plugins tab shows load diagnostics and
the plugin's contribution summary.

---

## 6. Publishing

1. Name the package `openfox-<name>` (scoped names are supported).
2. Set `"type": "module"` and point `openfox.entry` at the compiled ESM file.
3. Declare `openfox.capabilities` accurately — users see them before installing.
4. Publish to npm, or push the repository to GitHub and install by URL.
5. To be listed in the curated registry, open a PR adding an entry to
   `plugins-registry.json` with `name`, `displayName`, `description`, and
   `githubUrl`.

---

## 7. Troubleshooting

| Symptom                                                              | Cause                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Plugin shows **Error** with `Unsupported OpenFox plugin API version` | `openfox.apiVersion` is missing or not `1`/`2`                                  |
| `Plugin does not export register(registry)`                          | Entry point must export a named `register` function                             |
| `Plugin tool 'x' collides with a built-in tool`                      | Rename the tool; built-ins cannot be shadowed                                   |
| `Plugin <kind> 'x' is already registered by 'y'`                     | Two plugins claim the same id; ids must be unique per kind                      |
| Action/panel missing in the UI                                       | Check the plugin is enabled and the `slot` value is one of the documented slots |
| RPC returns `no RPC method`                                          | The method name must match `registerRpc` exactly and the plugin must be enabled |
| RPC returns `does not declare the 'rpc' capability`                  | Add `"rpc"` to `openfox.capabilities`, or omit the array entirely               |
| Settings save fails with `must be a number`                          | Values are validated against your schema server-side                            |
