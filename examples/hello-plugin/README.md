# openfox-hello-plugin

Reference OpenFox plugin demonstrating every contribution point:

- a tool (`hello_plugin_greet`)
- a slash command (`hello-plugin`)
- schema-driven settings (including a masked secret)
- a header action opening a declarative panel
- a panel with a `{{greeting}}` placeholder fed by `context.publish`
- an RPC method that emits a notification
- a `turn.completed` hook
- a workflow transition handler

Plain ESM with JSDoc types — the entry point (`src/index.js`) loads as-is, no
build step required.

```bash
# Type-check against the real openfox/plugin contract
npm run typecheck

# Unit tests (fake registry)
npm test
```

Install it from **Settings → Plugins** with the local path to this directory, or
copy it into `~/.config/openfox/plugins/`.

Full authoring guide: [`docs/PLUGINS.md`](../../docs/PLUGINS.md).
