export interface DevServerConfig {
  command: string
  url: string
  hotReload: boolean
}

export type DevServerState = 'off' | 'running' | 'warning' | 'error'

export interface DevServerStatus {
  state: DevServerState
  url: string | null
  hotReload: boolean
  config: DevServerConfig | null
  errorMessage: string | undefined
}
