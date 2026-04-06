import WebSocket from 'ws'
import { terminalManager } from '../terminal/manager.js'

interface TerminalMessage {
  type: 'terminal.subscribe' | 'terminal.write' | 'terminal.resize' | 'terminal.kill'
  payload: {
    sessionId?: string
    data?: string
    cols?: number
    rows?: number
    workdir?: string
  }
}

interface TerminalSubscription {
  ws: WebSocket
  sessionId: string
}

const subscriptions = new Set<TerminalSubscription>()

let outputHandlerRegistered = false

function registerOutputHandler(): void {
  if (outputHandlerRegistered) return
  outputHandlerRegistered = true

  terminalManager.onOutput((output) => {
    const subs = Array.from(subscriptions).filter(
      s => s.sessionId === output.sessionId && s.ws.readyState === WebSocket.OPEN
    )
    for (const sub of subs) {
      sub.ws.send(JSON.stringify({
        type: 'terminal.output',
        payload: { sessionId: output.sessionId, data: output.data },
      }))
    }
  })
}

export function handleTerminalMessage(ws: WebSocket, message: TerminalMessage): void {
  switch (message.type) {
    case 'terminal.subscribe': {
      if (message.payload.sessionId) {
        subscriptions.add({ ws, sessionId: message.payload.sessionId })
        registerOutputHandler()
        
        const sessionId = message.payload.sessionId
        const history = terminalManager.getOutputHistory(sessionId)
        if (history) {
          setTimeout(() => {
            ws.send(JSON.stringify({
              type: 'terminal.output',
              payload: { sessionId, data: history },
            }))
          }, 100)
        }
      }
      break
    }
    case 'terminal.write': {
      if (message.payload.sessionId && message.payload.data) {
        terminalManager.write(message.payload.sessionId, message.payload.data)
      }
      break
    }
    case 'terminal.resize': {
      if (message.payload.sessionId && message.payload.cols && message.payload.rows) {
        terminalManager.resize(message.payload.sessionId, message.payload.cols, message.payload.rows)
      }
      break
    }
    case 'terminal.kill': {
      if (message.payload.sessionId) {
        terminalManager.kill(message.payload.sessionId)
        
        for (const sub of subscriptions) {
          if (sub.sessionId === message.payload.sessionId) {
            subscriptions.delete(sub)
          }
        }
        
        ws.send(JSON.stringify({
          type: 'terminal.killed',
          payload: { sessionId: message.payload.sessionId },
        }))
      }
      break
    }
  }
}

export function subscribeToTerminal(ws: WebSocket, sessionId: string): void {
  subscriptions.add({ ws, sessionId })
}

export function unsubscribeFromTerminal(ws: WebSocket, sessionId: string): void {
  for (const sub of subscriptions) {
    if (sub.ws === ws && sub.sessionId === sessionId) {
      subscriptions.delete(sub)
    }
  }
}

export function unsubscribeAllFromTerminal(ws: WebSocket): void {
  for (const sub of subscriptions) {
    if (sub.ws === ws) {
      subscriptions.delete(sub)
    }
  }
}