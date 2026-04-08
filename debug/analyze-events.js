#!/usr/bin/env node
/**
 * Debug script to capture all events from a conversation
 */

import { WebSocket } from 'ws'

const SERVER_URL = 'http://localhost:10469'
const WS_URL = 'ws://localhost:10469/ws'
const PROJECT_ID = '70cafde1-b5c2-4099-b61d-011730170bfd'
const PROMPT = `write a 1000-word essay on cat vs dogs in /tmp/essay-${Math.round(Math.random()*10000)}.txt`

let sessionId = ''
let ws
let messageId = 0

let last_event = ''

function logEvent(msg) {
  const { type, payload } = msg
  const error = msg.error || (payload?.code ? payload : null)

  const discard = ['session.running', 'session.state', 'ack', 'chat.message_updated', 'context.state']
  if (discard.includes(type)) {
    return
  }

  if (last_event !== type) {
    last_event = type
    console.log('\n\n',new Date(),'- type=', type, "->")
  }

  if (type === 'chat.thinking' || type === 'chat.delta') {
    process.stdout.write(msg.payload.content.replace(/\n/g,''))
    return
  }


  switch (type) {
    case 'session.state':
      console.log(`\t\tsession ${payload.session?.id} (mode: ${payload.session?.mode}, running: ${payload.session?.isRunning})`)
      break
    case 'session.running':
      console.log(`\t\trunning: ${payload.isRunning}`)
      break
    case 'context.state':
      console.log(`\t\tcontext: ${payload.context.currentTokens}/${payload.context.maxTokens} tokens`)
      break
    case 'chat.tool_preparing':
      console.log(`\t\tpreparing: ${payload.name}`)
      break
    case 'chat.tool_call':
      console.log(`\t\ttool_call: ${payload.tool}`)
      break
    case 'chat.tool_result':
      const status = payload.result?.success ? '✓' : '✗'
      console.log(`\t\t${status} ${payload.tool} → ${payload.result?.error ? 'error: ' + payload.result.error : 'ok'}`)
      break
    case 'chat.done':
      console.log(`\t\tdone (${payload.reason})`)
      break
    case 'chat.message_updated':
      console.log(`\t\tmessage_updated: ${Object.keys(payload.updates).length}`)
      break
    case 'chat.message':
      console.log(`\t\tmessage: ${payload.message.content.replace(/\n/g, '').slice(0, 50)}...`)
      break
    case 'error':
      console.log(`\t\t${error?.code || 'UNKNOWN'}: ${error?.message || JSON.stringify(error)}`)
      break
    case 'ack':
      break
    default:
      console.log(`\t\t${type}`, JSON.stringify(payload))
  }
}

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`)
      if (res.ok) return true
    } catch {
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

async function createSession() {
  const res = await fetch(`${SERVER_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: PROJECT_ID, title: 'Debug' }),
  })
  const data = await res.json()
  return data.session?.id
}

async function switchToBuilder() {
  await fetch(`${SERVER_URL}/api/sessions/${sessionId}/mode`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'builder' }),
  })
}

async function run() {
  console.log('=== OpenFox Debug ===')

  const ready = await waitForServer()
  if (!ready) {
    console.error('Server not ready')
    process.exit(1)
  }

  sessionId = await createSession()
  console.log(`Session: ${sessionId}`)

  await switchToBuilder()
  await new Promise(r => setTimeout(r, 500))

  ws = new WebSocket(WS_URL)

  ws.on('open', () => {
    console.log('Connected\n')
    ws.send(JSON.stringify({ id: String(++messageId), type: 'session.load', payload: { sessionId } }))
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())

      if (!msg || !msg.type) {
        console.log('Unknown message:', msg)
        return
      }

      logEvent(msg)

      if (msg.type === 'session.state' && !msg.error && !msg.payload.session.isRunning) {
        console.log('\n→ Sending message...\n')
        ws.send(JSON.stringify({
          id: String(++messageId),
          type: 'chat.send',
          payload: { content: PROMPT },
        }))
      }

      if (msg.type === 'chat.done') {
        setTimeout(() => process.exit(0), 1000)
      }
    } catch (e) {
      console.log('Parse error:', e.message)
    }
  })

  ws.on('error', (e) => console.log('WS error:', e.message))
}

run().catch(e => {
  console.error('Error:', e)
  process.exit(1)
})