import * as pty from 'node-pty'
import os from 'node:os'
import { logger } from '../utils/logger.js'
import { getPlatformShell } from '../utils/platform.js'

export interface TerminalSession {
  id: string
  pty: pty.IPty
  workdir: string
  projectId: string
}

export interface TerminalOutput {
  sessionId: string
  data: string
}

export type OutputCallback = (output: TerminalOutput) => void
export type ExitCallback = (sessionId: string, exitCode: number) => void

class TerminalManager {
  private sessions = new Map<string, TerminalSession>()
  private outputCallbacks = new Set<OutputCallback>()
  private exitCallbacks = new Set<ExitCallback>()
  private outputHistory = new Map<string, string[]>()

  private generateId(): string {
    return `term_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }

  private getShell(): string {
    return getPlatformShell().command
  }

  private resolveWorkdir(workdir: string | undefined): string {
    if (workdir && workdir.length > 0) {
      return workdir
    }
    return os.homedir()
  }

  create(workdir?: string, projectId?: string): TerminalSession {
    const id = this.generateId()
    const shell = this.getShell()
    const cwd = this.resolveWorkdir(workdir)

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as { [key: string]: string },
    })

    const session: TerminalSession = {
      id,
      pty: ptyProcess,
      workdir: cwd,
      projectId: projectId ?? '',
    }

    ptyProcess.onData((data: string) => {
      const output: TerminalOutput = { sessionId: id, data }
      for (const cb of this.outputCallbacks) {
        cb(output)
      }
      const history = this.outputHistory.get(id) || []
      history.push(data)
      if (history.length > 10000) history.shift()
      this.outputHistory.set(id, history)
    })

    ptyProcess.onExit(({ exitCode }) => {
      logger.info('Terminal session exited', { id, exitCode })
      this.sessions.delete(id)
      this.outputHistory.delete(id)
      for (const cb of this.exitCallbacks) {
        cb(id, exitCode)
      }
    })

    this.sessions.set(id, session)
    logger.info('Terminal session created', { id, shell, cwd })

    return session
  }

  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return false
    }
    try {
      session.pty.write(data)
      return true
    } catch {
      return false
    }
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return false
    }
    try {
      session.pty.resize(cols, rows)
      return true
    } catch {
      return false
    }
  }

  kill(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return false
    }
    session.pty.kill()
    this.sessions.delete(sessionId)
    logger.info('Terminal session killed', { id: sessionId })
    return true
  }

  get(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId)
  }

  getAll(): TerminalSession[] {
    return Array.from(this.sessions.values())
  }

  getByProject(projectId: string): TerminalSession[] {
    if (!projectId) return []
    return Array.from(this.sessions.values()).filter(s => s.projectId === projectId)
  }

  getOutputHistory(sessionId: string): string {
    return (this.outputHistory.get(sessionId) || []).join('')
  }

  onOutput(callback: OutputCallback): () => void {
    this.outputCallbacks.add(callback)
    return () => {
      this.outputCallbacks.delete(callback)
    }
  }

  onExit(callback: ExitCallback): () => void {
    this.exitCallbacks.add(callback)
    return () => {
      this.exitCallbacks.delete(callback)
    }
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.pty.kill()
    }
    this.sessions.clear()
    logger.info('All terminal sessions killed')
  }
}

export const terminalManager = new TerminalManager()