# Plugin System Architecture

> How the OpenFox plugin system works under the hood — for maintainers and
> plugin authors who want to understand the machinery, not just the API.
> For the authoring contract (manifest, registry methods, examples), read
> [PLUGINS.md](PLUGINS.md) first. This document explains what the host does
> with what you register.

## 1. Design goals

| Goal                          | How it is achieved                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Extend without forking**    | Every extension point of the app (tools, commands, skills, providers, UI, settings, hooks, workflows, notifications) is contributed through one registry |
| **Core stays in control**     | Plugins can only _contribute_ through `PluginRegistry`; they cannot patch internals or monkey-patch the server                                           |
| **Failure isolation**         | A plugin that throws during `register()` or at runtime is reported as a diagnostic and never blocks other plugins or the server                          |
| **No UI breakage**            | UI contributions are declarative descriptors rendered by the host; plugins never ship React code, so web refactors cannot break the contract             |
| **Trust transparency**        | Capabilities are declared in the manifest and shown to users before and after install                                                                    |
| **Dumb client, smart server** | All plugin state (registry, settings, UI contributions, notifications) is normalized server-side and streamed to clients in the same shape as REST data  |

### Trust model

Plugins run in-process with full Node.js privileges and there is no sandbox —
the isolation guarantees are about failure, not security. The canonical trust
model (what plugins can do, what the curated registry is for, why
project-local plugin code is never loaded) lives in
[PLUGINS.md § Trust model](PLUGINS.md#1-concepts).

## 2. Module map

```
src/
├── plugin/index.ts              # Public contract: `openfox/plugin`
│                                #   PLUGIN_API_VERSION, pluginManifestSchema,
│                                #   PluginRegistry interface, all plugin types
├── shared/plugin.ts             # Wire-format descriptors shared by server + web
│                                #   (slots, panels, settings schema, notifications)
└── server/plugins/
    ├── host.ts                  # PluginHost: lifecycle, install, enable/disable,
    │                            #   RPC dispatch, settings, wiring into the server
    ├── registry.ts              # PluginRegistry: contribution stores, conflict
    │                            #   detection, ownership, contribution summaries
    ├── loader.ts                # Discovery + manifest validation + ESM import
    ├── install.ts               # GitHub / npm / local-path install pipeline
    ├── hooks.ts                 # HookBus: event fan-out with timeout isolation
    ├── hook-emitter.ts          # Module-level bridge: server events → HookBus
    ├── notifications.ts         # NotificationService: persist + stream + REST/WS
    ├── settings.ts              # Settings read/write with secret masking
    ├── model-metadata.ts        # Merge plugin metadata into /api/providers
    ├── transition-handlers.ts   # Workflow transition registry (namespaced)
    └── asset-auth.ts            # Token forwarding for sandboxed iframes

web/src/
├── components/plugins/          # PluginPanelHost, PluginSlot, declarative
│                                #   panel renderer, settings form, badges
├── lib/plugin-ws.ts             # WS integration for plugin UI state
├── lib/plugin-actions.ts        # RPC / panel / URL activation dispatch
├── hooks/usePlugins.ts          # Plugin state via resource cache
└── stores/pluginUi.ts          # Open panels, ui_state values
```

The split between `src/plugin/index.ts` and `src/shared/plugin.ts` is
intentional: the former is the **public authoring contract** (what a plugin
exports and calls), the latter is the **wire format** (what server and web
exchange). A plugin type never leaks a server-internal type, and the web never
imports server code.

## 3. Lifecycle

### 3.1 Discovery and load

```
PluginHost.start()
  │
  ├─ readDisabled()                       ← settings key 'plugin.disabled' (JSON array)
  ├─ registry.setReservedToolNames(...)   ← built-in tool names can't be shadowed
  │
  ├─ loadPlugins()                        (loader.ts)
  │   │
  │   │  Roots scanned in order, dedup by package name:
  │   │    1. {configDir}/plugins/<name>
  │   │    2. {configDir}/plugins/node_modules/<name>   (npm installs)
  │   │    3. {cwd}/node_modules/<name>                (dev usage)
  │   │
  │   ├─ for each package dir:
  │   │    ├─ readPluginManifest()        ← package.json + pluginManifestSchema
  │   │    │    (invalid manifest → plugin silently skipped, not an error)
  │   │    ├─ shouldLoad? disabled → diagnostic { enabled: false }, skip
  │   │    └─ loadPluginFromDirectory()
  │   │         ├─ apiVersion must be 1 or 2  → else diagnostic error
  │   │         ├─ entry = openfox.entry ?? openfox.plugin
  │   │         ├─ registry.beginPlugin(name, context)
  │   │         ├─ await import(entryUrl)          ← ESM dynamic import
  │   │         ├─ module.register must be a function → else diagnostic error
  │   │         ├─ await module.register(registry)
  │   │         ├─ check registry.getConflicts()   → any conflict rejects the
  │   │         │    whole plugin (loaded=false, removePlugin, error strings)
  │   │         └─ capture deactivate() for later enable/disable cycles
  │   │
  │   └─ returns PluginDiagnostic[]        (one per plugin, loaded or not)
  │
  ├─ records.set(diagnostic)               ← host's source of truth per plugin
  ├─ applyContributions()                  ← wire everything into the server (below)
  └─ setPluginHookEmitter()                ← future server events reach the HookBus
```

Key points:

- **Manifest validation is Zod** (`pluginManifestSchema`): name, version, and
  the `openfox` object. The host additionally rejects `apiVersion` other than
  `1`/`2` with `Unsupported OpenFox plugin API version`.
- **A plugin registers only while `beginPlugin` is active**: the registry tracks
  `currentPluginId` so every contribution is attributed to its owner, and
  `registry.context` is only valid during `register()`.
- **Conflicts reject the whole plugin** — duplicate ids across plugins, or a
  tool colliding with a built-in name, mark the plugin as failed with the
  conflict strings as its error. This keeps the registry unambiguous.
- **Failed loads are non-fatal**: the diagnostic (red status in the Plugins tab)
  is the only consequence. The server and other plugins are unaffected.

### 3.2 Enable / disable / uninstall

```
enable(id)    → re-read manifest at record.source, cache-busted re-import
                (entryUrl + '?v=' + Date.now()), register() again, applyContributions()
disable(id)    → runDeactivate() (optional plugin hook), registry.removePlugin(id)
                (drops every contribution + hook + transition), persist disabled list
uninstall(id)   → same as disable + rm -rf the directory (only if under
                {configDir}/plugins — node_modules discoveries are not removable)
```

The disabled list is a single settings row (`plugin.disabled`, JSON array of
package names) read from the plugin-scoped settings table. Because enable does a
**cache-busted re-import**, a plugin module is re-executed from scratch — this
is why state must live in `context.storage`, not module variables.

### 3.3 Install pipeline

```
installFromGithub(url)   git clone --depth 1 → {configDir}/plugins/<repo>
installFromNpm(name)     npm install --prefix {configDir}/plugins → node_modules/<name>
installFromPath(path)    copy (excluding node_modules/.git) → {configDir}/plugins/<basename>

                        └─ buildIfNeeded(): npm install + npm run build if the
                           package declares a build script

all three  →  installFromDirectory()
                  ├─ readPluginManifest()  → not an OpenFox plugin → throw
                  ├─ loadPluginFromDirectory({ cacheBust: true })
                  └─ applyContributions()
```

Installs happen at runtime; no server restart is needed. The installed package
becomes the source of truth in the record, and the plugin is loaded
immediately.

### 3.4 applyContributions — the wiring step

After every lifecycle change (start, enable, disable, uninstall, install) the
host pushes the aggregated registry state into the server internals:

| Call                                   | Effect                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `setPluginTools(...)`                  | Plugin tools become callable agent tools (Settings → Tools)                 |
| `setPluginCommands(...)`               | Slash commands join the command registry with `pluginId` provenance         |
| `setPluginModelMetadataProviders(...)` | Metadata providers merge into `/api/providers` responses                    |
| `refreshSkillSources()`                | Calls each source's `load()`, skills join discovery with `source: 'plugin'` |

UI contributions, badges, panels, RPC methods, hooks, transitions and assets
are not "applied" — they are read directly from the registry by the routes
(`/api/plugins`), the agent loop, and the workflow executor.

## 4. Contribution flow at runtime

### 4.1 Tools

```
LLM → tool call 'demo_echo'
  → src/server/tools/index.ts: tool registry finds plugin tool
  → tool.execute(args, { sessionId, workdir, projectId, signal })
  → { success, output } → rendered like any tool result
```

- Plugin tools **must be allow-listed** in an agent's `allowedTools` to be
  callable — same rule as built-ins.
- Tool name collisions with built-ins are rejected at registration.
- Thrown errors become `{ success: false, error }` results, not crashes.

### 4.2 Hooks

```
server event (e.g. EventStore 'chat.done')
  → hook-emitter (setPluginHookEmitter)          [module-level bridge]
  → HookBus.emit(event, payload)
      → registry.getHookHandlers(event)
      → Promise.all(handlers, each with 5s timeout)
      → failure/slow → logger.warn, ignored; never blocks the turn
```

`PluginHost.attachEventStore(eventStore)` subscribes to **all** stored events
and maps them to hook events via `EVENT_HOOK_MAP` (host.ts):

| Stored event                 | Hook event                                    | Note                            |
| ---------------------------- | --------------------------------------------- | ------------------------------- |
| `chat.done`                  | `turn.completed` or `workflow.step.completed` | `reason === 'step_done'` → step |
| `session.initialized`        | `session.created`                             |                                 |
| `message.done`               | `message.created`                             |                                 |
| `tool.result`                | `tool.completed`                              |                                 |
| `criterion.updated`          | `criterion.updated`                           |                                 |
| `workflow.execution_changed` | `workflow.execution.changed`                  |                                 |
| `task.completed`             | `task.completed`                              |                                 |

`llm.completed` is the one exception: it is emitted directly from the agent
loop (`agent-loop.ts`, after each completion attempt) through the same
`setPluginHookEmitter` bridge, not from the event-store subscription.

Hooks are strictly observational — the agent loop never awaits hook results to
decide anything.

### 4.3 RPC

```
web action click → POST /api/plugins/<pluginId>/rpc/<method>
  → PluginHost.invokeRpc(pluginId, method, params, ctx)
      ├─ record exists & enabled
      ├─ capabilities gate: non-empty list must include 'rpc'
      ├─ registry.getRpcHandler(pluginId, method)   (ownership-checked)
      └─ withTimeout(handler(params, ctx), manifest.timeoutMs ?? 30s)
```

The RPC path is also used by notification actions, panel buttons, iframe pages
and badges with a `source: { kind: 'rpc' }`.

### 4.4 UI contributions

Slots and rendering are described in the user docs (PLUGINS.md §3 UI). What
matters architecturally:

- The web fetches `GET /api/plugins/ui` → `{ actions, badges, panels, sections }`
  from `registry.getUiContributions()` — ownership stamped on every entry.
- Actions dispatch through `web/src/lib/plugin-actions.ts` (`rpc` / `openPanel`
  / `openUrl`), so a notification action and a header button use the exact same
  activation contract.
- Declarative panels re-render on `plugin.ui_state` WS messages; iframe panels
  are sandboxed (`allow-scripts allow-forms`) and, when network auth is enabled,
  receive the session token as `?token=` since iframes cannot send headers.

### 4.5 Notifications

```
context.notify() (plugin)
  → NotificationService.emit(pluginId, request)
      ├─ persist (SQLite 'notifications' table)
      ├─ WS broadcast 'plugin.notification'
      └─ toasts + bell + NotificationCenter render the same shape as
         GET /api/notifications (streaming/fetch parity)
```

Notification **actions** use the same `PluginActivation` contract as UI actions,
so `plugin-actions.ts` handles both.

### 4.6 Model metadata

```
GET /api/providers
  → listProviders()
  → for each provider model: plugin metadata providers consulted (in order)
  → merged into the response (pricing, contextWindow, vision, badges)
  → never mutates persisted configuration
```

### 4.7 Workflow transitions

```
workflow step ends → executor evaluates outgoing transitions
  → { when: { type: 'custom', handler: 'needs_review' } }
  → transition-handlers.ts lookup by '<pluginId>:<name>'
  → handler({ workflowId, stepId, config, outcome, metadataEntries }) → boolean
  → unknown handler or error → false (an 'always' transition can still fire)
```

Transition handlers are namespaced `pluginId:handlerName` so two plugins can
use the same short name.

### 4.8 Assets

```
GET /api/plugins/<pluginId>/assets/<path>
  → only paths declared via registerAsset() are served
  → path traversal rejected
  → read-only
```

## 5. Data layer

### Settings and storage

- **Settings** (`settings.ts`): plugin-declared schema, values stored per
  plugin in the DB. Global vs project scope. Secrets (`secret: true` /
  `type: 'password'`) are never returned in cleartext — reads return a
  `secretsSet` list, and an empty submitted value keeps the stored secret.
- **Storage** (`context.storage`): tiny per-plugin KV store layered on the
  global settings table with JSON serialization. This is the only state that
  survives enable/disable cycles, since modules are re-imported on enable.

### Where UI state lives

| State                           | Location                        | Sync                            |
| ------------------------------- | ------------------------------- | ------------------------------- |
| Plugins list + contributions    | `pluginsResource`               | REST + WS after changes         |
| UI contributions (slots)        | resource over `/api/plugins/ui` | on change                       |
| Open panels + `ui_state` values | `pluginUi` store (web)          | WS `plugin.ui_state`            |
| Notifications                   | `notificationsResource`         | REST + WS `plugin.notification` |
| Plugin toasts                   | `pluginToasts` store            | ephemeral                       |

All WS payloads have the same shape as their REST equivalents — the web renders
identically whether data arrived streamed or refetched.

## 6. API v1 compatibility

`apiVersion: 1` plugins (provider-only, legacy) run through the exact same
host and registry — there is no separate v1 code path, and the full
`PluginRegistry` is passed to their `register()` at runtime. The provider-only
restriction is a **documented contract and TypeScript type**
(`ProviderPluginRegistry` in `src/provider/index.ts`), not something the host
enforces: a v1 plugin that calls `registerTool` would not be rejected, it would
simply be violating the contract. Everything else in this document applies
unchanged.

## 7. Extension points summary

| Capability      | Registry method(s)                                       | Surfaces in                              |
| --------------- | -------------------------------------------------------- | ---------------------------------------- |
| `providers`     | `registerAuth`, `registerTransport`, `registerPreset`    | Provider setup wizard, agent loop        |
| `models`        | `registerModelMetadataProvider`                          | Model picker, `/api/providers`           |
| `tools`         | `registerTool`                                           | Agent tool list, Settings → Tools        |
| `commands`      | `registerCommand`                                        | Slash commands, Commands settings        |
| `skills`        | `registerSkillSource`                                    | Skill discovery (`source: 'plugin'`)     |
| `settings`      | `registerSettings`                                       | Plugins tab auto-form                    |
| `ui`            | `registerUiAction`, `registerUiBadge`, `registerUiPanel` | Header, session, message, composer slots |
| `hooks`         | `registerHook`                                           | Background (observational)               |
| `workflows`     | `registerTransitionHandler`                              | Workflow `when: custom` transitions      |
| `rpc`           | `registerRpc`                                            | `POST /api/plugins/<id>/rpc/<method>`    |
| `assets`        | `registerAsset`                                          | `/api/plugins/<id>/assets/<path>`        |
| `notifications` | `context.notify`                                         | Toasts, bell, notification center        |

## 8. Where to look next

- Authoring contract and examples: [PLUGINS.md](PLUGINS.md)
- Working minimal plugin: [`examples/hello-plugin`](../examples/hello-plugin)
- Kitchen-sink demo plugin exercising every capability: the
  `openfox-demo-plugin` package (companion `openfox-plugins` repository,
  maintained alongside OpenFox — install it from a local clone via
  Settings → Plugins)
- Server tests for the host: `src/server/plugins/host.test.ts`
- E2E: `e2e/plugin-system.test.ts`
