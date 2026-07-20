/**
 * Mock MCP server for e2e testing.
 * Implements a minimal MCP stdio server with a few test tools.
 */
import { randomUUID } from 'node:crypto'

const tools = [
  {
    name: 'greet',
    description: 'Greet someone by name',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name to greet' } },
      required: ['name'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
  {
    name: 'slow',
    description: 'Responds after a delay (ms)',
    inputSchema: {
      type: 'object',
      properties: { delay: { type: 'number', description: 'Delay in milliseconds' } },
      required: ['delay'],
    },
  },
]

let initialized = false

function sendMessage(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function handleMessage(raw: string) {
  let msg: { id?: unknown; method?: string; params?: unknown }
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }

  if (msg.method === 'initialize') {
    initialized = true
    sendMessage({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
      },
    })
    return
  }

  if (msg.method === 'notifications/initialized') {
    return
  }

  if (!initialized) return

  if (msg.method === 'tools/list') {
    sendMessage({
      jsonrpc: '2.0',
      id: msg.id,
      result: { tools },
    })
    return
  }

  if (msg.method === 'tools/call') {
    const params = msg.params as { name?: string; arguments?: Record<string, unknown> }
    if (params.name === 'greet') {
      const name = (params.arguments?.name as string) ?? 'World'
      sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `Hello, ${name}!` }],
          isError: false,
        },
      })
    } else if (params.name === 'add') {
      const a = Number(params.arguments?.a ?? 0)
      const b = Number(params.arguments?.b ?? 0)
      sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: String(a + b) }],
          isError: false,
        },
      })
    } else if (params.name === 'slow') {
      const delay = Number(params.arguments?.delay ?? 1000)
      setTimeout(async () => {
        sendMessage({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: `Slept for ${delay}ms` }],
            isError: false,
          },
        })
      }, delay)
    } else {
      sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32602, message: `Unknown tool: ${params.name}` },
      })
    }
    return
  }

  // Ping
  if (msg.method === 'ping') {
    sendMessage({ jsonrpc: '2.0', id: msg.id, result: {} })
    return
  }
}

const rl = (await import('node:readline')).createInterface({ input: process.stdin })
rl.on('line', handleMessage)
rl.on('close', () => process.exit(0))
