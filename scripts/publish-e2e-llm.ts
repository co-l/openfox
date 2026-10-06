/**
 * Pure helpers backing the publish E2E LLM fallback.
 *
 * `OPENFOX_PUBLISH_E2E_LLM=prod` lets the prepublish full-stack test run against
 * the LLM provider configured in the user's production config instead of the
 * hardcoded local model server — used when that server is unavailable.
 *
 * No I/O lives here: the caller reads the config file and passes the parsed
 * object in, so selection is deterministic and unit-testable.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export type PublishE2eLlmMode = 'local' | 'prod'

export interface ProdLlmSelection {
  url: string
  apiKey: string
  model: string
}

interface RawModel {
  id?: unknown
  selected?: unknown
}

interface RawProvider {
  name?: unknown
  url?: unknown
  apiKey?: unknown
  isActive?: unknown
  models?: unknown
}

/**
 * Resolve the requested LLM mode. Absent/blank/`local` → `local` (default off);
 * `prod` → `prod`; anything else fails fast so a typo never silently falls back.
 */
export function resolveLlmMode(raw: string | undefined): PublishE2eLlmMode {
  const value = raw?.trim().toLowerCase()
  if (!value || value === 'local') return 'local'
  if (value === 'prod') return 'prod'
  throw new Error(`Invalid OPENFOX_PUBLISH_E2E_LLM="${raw}" (expected "local" or "prod")`)
}

/** Production config path, overridable via `OPENFOX_PUBLISH_E2E_PROD_CONFIG`. */
export function resolveProdConfigPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const override = env['OPENFOX_PUBLISH_E2E_PROD_CONFIG']?.trim()
  return override ? override : join(home, '.config', 'openfox', 'config.json')
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function selectedModel(provider: RawProvider): string | undefined {
  const models = Array.isArray(provider.models) ? (provider.models as RawModel[]) : []
  const usable = models.filter((m) => asString(m.id) !== undefined)
  if (usable.length === 0) return undefined
  const selected = usable.find((m) => m.selected === true)
  return asString((selected ?? usable[0])?.id)
}

/**
 * Select the provider to drive the publish E2E from a parsed production config.
 *
 * With `providerName`, that provider is matched by name (case-insensitive) and
 * `isActive` is ignored. Otherwise the active provider holding an `apiKey` wins
 * (credentialRef-only providers are skipped — their key is not readable here).
 */
export function selectProdLlm(config: unknown, providerName?: string): ProdLlmSelection {
  const providers = (config as { providers?: unknown } | null | undefined)?.providers
  if (!Array.isArray(providers)) {
    throw new Error('Invalid production config: expected a "providers" array')
  }

  const candidates = providers as RawProvider[]
  const wanted = providerName?.trim().toLowerCase()

  const provider = wanted
    ? candidates.find((p) => asString(p.name)?.toLowerCase() === wanted)
    : candidates.find((p) => p.isActive === true && asString(p.apiKey) !== undefined)

  if (!provider) {
    throw new Error(
      wanted
        ? `No provider named "${providerName}" found in the production config`
        : 'No active provider with an api key found in the production config',
    )
  }

  const label = asString(provider.name) ?? 'provider'

  const url = asString(provider.url)
  if (!url) throw new Error(`Provider "${label}" has no url in the production config`)

  const apiKey = asString(provider.apiKey)
  if (!apiKey) {
    throw new Error(
      `Provider "${label}" has no api key in the production config (credentialRef-only providers are unsupported)`,
    )
  }

  const model = selectedModel(provider)
  if (!model) throw new Error(`Provider "${label}" has no models in the production config`)

  return { url, apiKey, model }
}
