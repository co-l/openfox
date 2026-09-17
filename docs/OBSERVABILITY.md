# OpenFox LLM Observability

This document describes the observability layer added in the
`feat/llm-context-cache-observability` branch. The layer is **diagnostic
only**: it surfaces LLM context usage, cache hit rates, retry counts,
compactions, and tool activity without changing agent behavior, prompts,
or compaction policy.

## Goals

- Help answer, from one dashboard, why a session used a lot of context
  and produced many LLM calls.
- Distinguish provider-reported cache metrics from OpenFox-estimated
  metrics.
- Provide a stable JSON export (`schemaVersion: 'obs.v1'`) suitable for
  cross-model benchmarks.

## Metrics

### Per call

Each LLM call carries the existing timing/tokens plus optional:

| Field                | Source   | Meaning                                                                                       |
| -------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `cachedPromptTokens` | provider | Tokens served from the provider's cache                                                       |
| `cacheWriteTokens`   | provider | Tokens written to the provider's cache                                                        |
| `cacheSource`        | provider | `'provider'` when the value comes from the provider's API response; `'unavailable'` otherwise |
| `contextSize`        | derived  | Prompt token count for this call                                                              |
| `retries`            | derived  | Retries counted up to and including this call                                                 |

### Per response

`MessageStats` carries `retryCount`, `compactionCount`, and aggregated
`cachedPromptTokens` / `cacheWriteTokens` / `cacheSource` across all
calls of the response.

### Session summary

| Field                                      | Source                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `rawPromptTokens`                          | Σ promptTokens over all calls                                                              |
| `providerCachedTokens`                     | Σ cachedPromptTokens over provider-cached calls only                                       |
| `cacheWriteTokens`                         | Σ cacheWriteTokens                                                                         |
| `estimatedNewInputTokens`                  | Σ promptTokens when `cacheSource !== 'provider'`, else `promptTokens − cachedPromptTokens` |
| `providerCacheHitRatio`                    | `providerCachedTokens / Σ promptTokens` over provider-cached calls                         |
| `contextP50` / `contextP95` / `contextMax` | percentiles over `promptTokens`                                                            |
| `contextAmplificationFactor`               | `rawPromptTokens / (rawPrompt − providerCached)`; only when `cacheSource === 'provider'`   |
| `generatedPerCall`                         | `generationTokens / llmCalls`                                                              |

### Compactions

Each `context.compacted` event becomes a `CompactionRecord`:

```
{
  timestamp, closedWindowId, newWindowId,
  beforeTokens, afterTokens, reduction, reductionPercent,
  subAgentId?, subAgentType?
}
```

### Retries

Retries are aggregated from `pattern.retry` events (provider pattern
matches) plus `MessageStats.retryCount` (which the agent loop
increments for truncation and continuation retries). Each record carries
a `type` of `'pattern' | 'truncation' | 'continuation'` so the
dashboard can show the breakdown.

### Tool activity

Tools are grouped by `ToolCategory` (see `src/shared/tool-category.ts`).
The raw `toolName` is preserved for drill-down. Categories:

```
read | search | edit | shell | test | git | browser | mcp | sub-agent | other
```

## JSON export shape

The "Copy JSON" button exports an `obs.v1` envelope:

```json
{
  "schemaVersion": "obs.v1",
  "exportedAt": "2024-01-01T00:00:00.000Z",
  "providerId": "...",
  "providerName": "...",
  "backend": "vllm",
  "model": "...",
  "label": "Local vLLM > model",
  "summary": {
    "totalTime": 0, "aiTime": 0, "toolTime": 0,
    "prefillTokens": 0, "generationTokens": 0,
    "avgPrefillSpeed": 0, "avgGenerationSpeed": 0,
    "responseCount": 0, "llmCallCount": 0
  },
  "responses": [...],
  "llmCalls": [...],
  "observability": {
    "summary": {
      "durationSeconds": 0, "responses": 0, "llmCalls": 0,
      "callsPerResponse": 0, "rawPromptTokens": 0,
      "providerCachedTokens": 0, "cacheWriteTokens": 0,
      "estimatedNewInputTokens": 0,
      "providerCacheHitRatio": 0, "contextP50": 0,
      "contextP95": 0, "contextMax": 0,
      "contextAmplificationFactor": 1.0,
      "amplificationSource": "provider",
      "generationTokens": 0, "generatedPerCall": 0,
      "cacheSource": "provider", "retries": 0,
      "compactions": 0, "subAgentCalls": 0, "toolCalls": 0
    },
    "compactions": [...],
    "retries": [...],
    "toolActivity": { "totalCount": 0, "totalErrors": 0, "byCategory": {...}, "byTool": [...] },
    "modelBreakdown": [...]
  }
}
```

The fields under `summary` are stable. New fields may be added in
future revisions without breaking existing consumers; consumers should
ignore unknown fields.

## Provider handling

Cache metrics are pulled by a single provider-agnostic extractor
(`extractTokenUsage` in `src/server/llm/usage.ts`). It recognises:

- `prompt_tokens_details.cached_tokens` (OpenAI)
- `cache_read_input_tokens` and `cache_creation_input_tokens`
  (Anthropic-style)
- `cached_tokens`, `cache_read_tokens`, `cache_creation_tokens`,
  `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`
  (other providers including MiniMax)

When none of these fields are present, `cacheSource` is
`'unavailable'` and cache-related ratios are hidden in the UI. **No
provider-specific branching exists in the UI or stats layer.**

## Dashboard sections

The `StatsModal` is extended with:

- **Overview**: raw prompt, cache read/write, new input, cache hit %,
  context P50/P95/Max, Context Amplification Factor (with `Provider` /
  `Estimated` / `N/A` badge).
- **Context & Cache**: SVG chart of `promptTokens` per call with cached
  portion overlay; compaction markers with `before → after` labels.
- **Agent Activity**: LLM / tool / retry / sub-agent / compaction counts
  and tool breakdown by category with per-tool drill-down.
- **Calls Timeline**: tabular view of every LLM call with
  `followingTool` column.

## Limitations

- Per-call provider cache attribution is best-effort: when a provider
  omits cache info entirely, the call has `cacheSource: 'unavailable'`
  and the cache-related ratios are hidden.
- `contextAmplificationFactor` requires at least one provider cache
  data point to be displayed. It is hidden otherwise.
- The dashboard currently re-aggregates observability client-side from
  the message stats + snapshot. Per-call event timestamps are derived
  from message timestamps.

## Backward compatibility

- No database migration: new fields are added to existing
  `MessageStats` / `LLMCallStats` as optional.
- Legacy sessions without the new fields render as `N/A` and never
  crash.
- Existing JSON consumers keep working: new fields ride along in the
  `observability` envelope.

## Tests

- `src/server/llm/usage.test.ts` — provider payload parsing
- `src/shared/tool-category.test.ts` — tool categorization
- `src/shared/observability.test.ts` — aggregation, compactions,
  retries, multi-model, legacy tolerance
- `web/src/hooks/useObservability.test.ts` — React hook integration
