import { Router } from 'express'
import type { Request, Response } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { logger } from '../../utils/logger.js'
import { createOpenFoxMcpTools } from './tools.js'
import type { OpenFoxMcpToolDeps } from './types.js'

export interface OpenFoxMcpRouterOptions {
  /** Resolve the live tool dependencies. Null until the server has finished wiring. */
  resolveDeps(): OpenFoxMcpToolDeps | null
  /** Whether network auth (a valid session token) is required for MCP requests. */
  isAuthRequired(): boolean
  /** Whether the request carries a valid session token. */
  isAuthorized(req: Request): Promise<boolean>
}

export function buildOpenFoxMcpServer(deps: OpenFoxMcpToolDeps): McpServer {
  const server = new McpServer({
    name: 'openfox',
    version: '1.0.0',
  })

  for (const tool of createOpenFoxMcpTools(deps)) {
    const config: Record<string, unknown> = { description: tool.description }
    if (Object.keys(tool.inputSchema).length > 0) {
      config['inputSchema'] = tool.inputSchema
    }
    server.registerTool(tool.name, config as never, async (args: unknown) =>
      tool.handler((args ?? {}) as Record<string, unknown>),
    )
  }

  return server
}

export function createOpenFoxMcpRouter(options: OpenFoxMcpRouterOptions): Router {
  const router = Router()

  router.all('/', async (req: Request, res: Response) => {
    try {
      if (options.isAuthRequired() && !(await options.isAuthorized(req))) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const deps = options.resolveDeps()
      if (!deps) {
        res.status(503).json({ error: 'MCP server is not ready' })
        return
      }

      const server = buildOpenFoxMcpServer(deps)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as never)
      await server.connect(transport as unknown as Transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      logger.error('MCP endpoint request failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request failed' })
      }
    }
  })

  return router
}

export function extractSessionToken(req: Request): string | null {
  const header = req.headers['x-session-token']
  if (typeof header === 'string' && header.length > 0) {
    return header
  }
  const authorization = req.headers['authorization']
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim()
    return token.length > 0 ? token : null
  }
  return null
}
