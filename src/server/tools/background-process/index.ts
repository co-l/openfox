import { createTool } from '../tool-helpers.js'
import * as manager from './manager.js'
import * as store from './store.js'
import { serverT } from '../../i18n.js'

export interface BackgroundProcessToolArgs {
  action: 'start' | 'stop' | 'list' | 'status' | 'logs'
  name?: string
  command?: string
  cwd?: string
  timeout?: number
  processId?: string
  since?: number
  maxLines?: number
}

function processNotFoundError(id: string | undefined): string {
  return serverT({ en: 'Process not found: {{id}}', fr: 'Processus introuvable : {{id}}' }, { id: id ?? '' })
}

export const backgroundProcessTool = createTool<BackgroundProcessToolArgs>(
  'background_process',
  {
    type: 'function',
    function: {
      name: 'background_process',
      description: `Start, stop, and monitor long-running background processes.

These processes run independently of agent turns and persist across session compaction. Processes are displayed in the right sidebar where you can view their logs and status.

**Actions:**
- start: Launch a new background process (provide: name, command, cwd, timeout)
- stop: Stop a running process and remove it from the sidebar
- list: Show all processes for this session
- status: Get detailed status of a specific process
- logs: Retrieve process output with optional pagination`,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'stop', 'list', 'status', 'logs'],
            description: 'The action to perform on background processes',
          },
          name: {
            type: 'string',
            description: 'Display name for the process. Auto-generated from command if not provided.',
          },
          command: {
            type: 'string',
            description: 'Shell command to execute. Required for "start" action.',
          },
          cwd: {
            type: 'string',
            description: 'Working directory. Defaults to session workdir.',
          },
          timeout: {
            type: 'number',
            description: 'Maximum runtime in milliseconds. Process will be terminated after this duration.',
          },
          processId: {
            type: 'string',
            description: 'Process ID. Required for stop, status, and logs actions.',
          },
          since: {
            type: 'number',
            description: 'Return logs after this offset. Default: 0',
          },
          maxLines: {
            type: 'number',
            description: 'Maximum lines to return. Default: 500, max: 2000',
          },
        },
        required: ['action'],
        dependentRequired: {
          start: ['command'],
          stop: ['processId'],
          status: ['processId'],
          logs: ['processId'],
        },
      },
    },
  },
  async (args, context, helpers) => {
    const sessionId = context.sessionId
    const cwd = args.cwd ?? context.workdir

    switch (args.action) {
      case 'start': {
        const count = store.getSessionProcessCount(sessionId)
        const maxPerSession = store.getMaxPerSession()

        if (count >= maxPerSession) {
          return helpers.error(
            serverT(
              {
                en: 'Maximum number of background processes ({{count}}) reached. Stop existing processes before starting new ones.',
                fr: 'Nombre maximal de processus en arrière-plan ({{count}}) atteint. Arrêtez des processus existants avant d’en démarrer de nouveaux.',
              },
              { count: maxPerSession },
            ),
          )
        }

        const name = args.name ?? args.command?.split(' ')[0] ?? 'process'
        const process = manager.createProcess(sessionId, name, args.command!, cwd, args.timeout)

        if (!process) {
          return helpers.error(
            serverT({
              en: 'Failed to create process. Maximum limit may have been reached.',
              fr: 'Échec de la création du processus. La limite maximale a peut-être été atteinte.',
            }),
          )
        }

        const pid = manager.startProcessCommand(process.id, sessionId, args.command!, cwd)

        if (!pid) {
          return helpers.error(serverT({ en: 'Failed to start process.', fr: 'Échec du démarrage du processus.' }))
        }

        return helpers.success(
          JSON.stringify(
            {
              processId: process.id,
              name: process.name,
              pid,
              status: 'running',
              maxReached: count + 1 >= maxPerSession,
            },
            null,
            2,
          ),
        )
      }

      case 'stop': {
        const proc = manager.getProcessStatus(args.processId!, sessionId)
        if (!proc) return helpers.error(processNotFoundError(args.processId))

        if (proc.status !== 'running') {
          return helpers.error(
            serverT(
              {
                en: 'Process is not running (status: {{status}}). Cannot stop.',
                fr: 'Le processus n’est pas en cours d’exécution (statut : {{status}}). Impossible de l’arrêter.',
              },
              { status: proc.status },
            ),
          )
        }

        await manager.stopProcess(args.processId!, sessionId)

        return helpers.success(
          JSON.stringify(
            {
              processId: args.processId,
              status: 'removed',
            },
            null,
            2,
          ),
        )
      }

      case 'list': {
        const processes = manager.getSessionProcesses(sessionId)
        const maxPerSession = store.getMaxPerSession()

        return helpers.success(
          JSON.stringify(
            {
              processes,
              maxPerSession,
              currentCount: processes.filter((p) => p.status !== 'exited').length,
            },
            null,
            2,
          ),
        )
      }

      case 'status': {
        const proc = manager.getProcessStatus(args.processId!, sessionId)
        if (!proc) return helpers.error(processNotFoundError(args.processId))

        const uptime = proc.startedAt ? Date.now() - proc.startedAt : null

        return helpers.success(
          JSON.stringify(
            {
              process: proc,
              uptime,
            },
            null,
            2,
          ),
        )
      }

      case 'logs': {
        const proc = manager.getProcessStatus(args.processId!, sessionId)
        if (!proc) return helpers.error(processNotFoundError(args.processId))

        const since = args.since ?? 0
        const maxLines = Math.min(args.maxLines ?? 500, 2000)
        const { lines, totalLines, nextOffset, hasMore } = manager.getProcessLogs(args.processId!, since, maxLines)

        return helpers.success(
          JSON.stringify(
            {
              processId: args.processId,
              lines,
              totalLines,
              nextOffset,
              hasMore,
              truncated: hasMore,
            },
            null,
            2,
          ),
        )
      }

      default:
        return helpers.error(
          serverT({ en: 'Unknown action: {{action}}', fr: 'Action inconnue : {{action}}' }, { action: args.action }),
        )
    }
  },
)
