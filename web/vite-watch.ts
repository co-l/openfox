import type { WatchOptions } from 'vite'

type PollingValue = '1' | 'true' | 'yes' | 'on' | '0' | 'false' | 'no' | 'off' | undefined

export interface ViteWatchRuntimeOptions {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
}

function resolvePollingOverride(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase() as PollingValue
  if (!normalized) {
    return undefined
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  return undefined
}

export function createViteWatchOptions(options: ViteWatchRuntimeOptions = {}): WatchOptions {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const explicitPolling = resolvePollingOverride(env.OPENFOX_VITE_USE_POLLING)
  const usePolling = explicitPolling ?? platform === 'linux'

  return {
    ignored: ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.openfox/**'],
    usePolling,
    ...(usePolling
      ? {
          interval: 150,
          binaryInterval: 300,
          awaitWriteFinish: {
            stabilityThreshold: 75,
            pollInterval: 25,
          },
        }
      : {}),
  }
}
