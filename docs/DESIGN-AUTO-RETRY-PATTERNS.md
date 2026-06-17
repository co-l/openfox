# Auto-Retry Pattern Matching

## Goal

Replace the hardcoded "Disable XML Tool Call Protection" toggle with a user-configurable auto-retry pattern matching system. Users define patterns that, when matched against LLM responses, trigger automated retries.

## User Experience

In the settings UI, instead of a single toggle, show a table with three columns:

| Field      | Pattern                       | Action |
| ---------- | ----------------------------- | ------ |
| `thinking` | `<!DSML!>`                    | retry  |
| `content`  | `I cannot complete this task` | retry  |

- **Field**: dropdown — `thinking`, `content`, or `both`
- **Pattern**: regex string the user types in
- **Action**: currently only `retry` (extensible for future: `stop`, `warn`, etc.)

When a pattern matches, the system auto-injects a "continue" message and re-runs the LLM. The user sees these retries in the chat feed as system-generated messages, clearly labeled as auto-retries.

The old "Disable XML Tool Call Protection" toggle is removed — the XML format error detection becomes a built-in default pattern that users can see and optionally disable in the table.

## Technical Design

### Config Shape

```ts
// In runtime config (openfox.json)
agent: {
  retryPatterns: Array<{
    field: 'thinking' | 'content' | 'both'
    pattern: string // regex string
    action: 'retry'
  }>
}
```

### Built-in Defaults

If no patterns are configured, these built-in defaults apply:

- `{ field: 'both', pattern: 'XML tool format', action: 'retry' }` (replaces old xmlFormatError detection)
- `{ field: 'content', pattern: '<functioncall>', action: 'retry' }` (common XML-style tool calls)

### Implementation Sketch

1. **Settings UI**: Table editor component (similar to criteria editor) in the settings panel. Add/remove rows, inline regex validation with visual feedback (green check / red X).

2. **Backend**: `retryPatterns` array in Config. On session start, patterns are compiled and passed to the agent loop.

3. **Agent loop**: After each LLM response, before tool execution:
   - Run patterns against `thinking` and/or `content`
   - On match: append "continue" message, loop back
   - Track retry count per pattern, cap at configurable max (default 5)
   - Emit `pattern.retry` events to EventStore for UI visibility

4. **EventStore**: New event type `pattern.retry` with `{ pattern: string, field: string, attempt: number }`

5. **Migration**: The old `llm.disableXmlProtection` setting is deprecated. On load, if set, migrate to an empty retryPatterns array (disabling all built-in patterns).

### Edge Cases

- **Infinite loops**: Max retries per turn (configurable, default 10 total across all patterns)
- **Overlapping patterns**: Multiple patterns can match in one response — all matching patterns' retries are counted against the total limit
- **Pattern compilation**: Invalid regex patterns are caught at config load time with a clear error message
- **Performance**: Pattern matching is O(n \* m) where n = patterns, m = response length. For typical usage (< 20 patterns, < 100K chars), this is negligible.
