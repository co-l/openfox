import { createTool } from './tool-helpers.js'
import { devServerManager } from '../dev-server/manager.js'

interface DevServerArgs {
  action: 'start' | 'stop' | 'restart' | 'status' | 'logs'
  offset?: number
  limit?: number
}

export const devServerTool = createTool<DevServerArgs>(
  'dev_server',
  {
    type: 'function',
    function: {
      name: 'dev_server',
      description: 'Control the project dev server. Start, stop, restart, check status, or fetch logs with optional pagination. The dev server command and URL are configured in .openfox/dev.json.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'stop', 'restart', 'status', 'logs'],
            description: 'The action to perform on the dev server',
          },
          offset: {
            type: 'number',
            description: 'Offset for log lines (0-based). Default: 0. Used with action=logs.',
          },
          limit: {
            type: 'number',
            description: 'Max number of log lines to return. Used with action=logs.',
          },
        },
        required: ['action'],
      },
    },
  },
  async (args, context, helpers) => {
    const workdir = context.workdir

    if (args.action === 'logs') {
      const offset = args.offset ?? 0
      const limit = args.limit ?? 100
      const result = devServerManager.getLogsSlice(workdir, offset, limit)

      const formattedLogs = result.logs.map(entry =>
        `${entry.stream === 'stderr' ? '[stderr] ' : ''}${entry.content}`
      ).join('')

      return helpers.success(JSON.stringify({
        logs: formattedLogs,
        total: result.total,
        offset,
        limit,
        hasMore: offset + limit < result.total,
      }, null, 2))
    }

    let status
    switch (args.action) {
      case 'start':
        status = await devServerManager.start(workdir)
        break
      case 'stop':
        status = await devServerManager.stop(workdir)
        break
      case 'restart':
        status = await devServerManager.restart(workdir)
        break
      case 'status':
        status = devServerManager.getStatus(workdir)
        if (!status.config) {
          const config = await devServerManager.loadConfig(workdir)
          if (config) {
            status.config = config
            status.url = config.url
            status.hotReload = config.hotReload
          }
        }
        break
    }

    if (!status.config) {
      return helpers.error(
        'No .openfox/dev.json config found. Create one with:\n\n' +
        '{\n  "command": "npm run dev",\n  "url": "http://localhost:3000",\n  "hotReload": true\n}'
      )
    }

    return helpers.success(JSON.stringify({
      state: status.state,
      url: status.url,
      hotReload: status.hotReload,
      ...(status.errorMessage ? { error: status.errorMessage } : {}),
    }, null, 2))
  }
)
