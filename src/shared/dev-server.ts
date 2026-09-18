export interface DevServerConfig {
  command: string
  url: string
  hotReload: boolean
  disableInspect?: boolean
  /**
   * When true, the dev server lifecycle auto-launches a tailnet-only Tailscale
   * preview after a successful start, and tears it down on stop / crash /
   * stopAll. Changes apply on the next Start/Restart — no hot toggle.
   */
  tailscaleExpose?: boolean
}

export type DevServerState = 'off' | 'running' | 'warning' | 'error'

export type TailscalePreviewStatus = 'idle' | 'starting' | 'active' | 'error'

export interface TailscalePreview {
  status: TailscalePreviewStatus
  url?: string
  error?: string
}

export interface DevServerStatus {
  state: DevServerState
  url: string | null
  hotReload: boolean
  config: DevServerConfig | null
  errorMessage: string | undefined
  inspectProxyPort: number | null
  tailscalePreview: TailscalePreview
}

export function idlePreview(): TailscalePreview {
  return { status: 'idle' }
}
