import type { Config } from '../shared/types.js'
import { loadConfig } from './config.js'

let runtimeConfig: Config | null = null

export function setRuntimeConfig(config: Config): void {
  runtimeConfig = config
}

export function getRuntimeConfig(): Config {
  return runtimeConfig ?? loadConfig()
}
