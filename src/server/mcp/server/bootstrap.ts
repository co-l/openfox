export interface OpenFoxMcpBootstrapInput {
  host: string
  port: number
  authRequired: boolean
  sessionToken: string | null
}

export interface OpenFoxMcpBootstrapConfig {
  name: string
  transport: 'http'
  url: string
  headers?: Record<string, string>
}

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '*'])

function normalizeHost(host: string): string {
  return WILDCARD_HOSTS.has(host) ? '127.0.0.1' : host
}

export function buildOpenFoxMcpBootstrap(input: OpenFoxMcpBootstrapInput): OpenFoxMcpBootstrapConfig {
  if (input.authRequired && !input.sessionToken) {
    throw new Error('Session token could not be computed — cannot bootstrap an authenticated MCP endpoint')
  }

  const config: OpenFoxMcpBootstrapConfig = {
    name: 'openfox',
    transport: 'http',
    url: `http://${normalizeHost(input.host)}:${input.port}/mcp`,
  }
  if (input.authRequired && input.sessionToken) {
    config.headers = { Authorization: `Bearer ${input.sessionToken}` }
  }
  return config
}
