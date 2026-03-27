import { createTool } from './tool-helpers.js'
import { devServerManager } from '../dev-server/manager.js'

interface DevServerArgs {
  action: 'start' | 'stop' | 'restart' | 'status'
}

export const devServerTool = createTool<DevServerArgs>(
  'dev_server',
  {
    type: 'function',
    function: {
      name: 'dev_server',
      description: 'Control the project dev server. Start, stop, restart, or check status. The dev server command and URL are configured in .openfox/dev.json.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'stop', 'restart', 'status'],
            description: 'The action to perform on the dev server',
          },
        },
        required: ['action'],
      },
    },
  },
  async (args, context, helpers) => {
    const workdir = context.workdir

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
        // Try loading config if not yet loaded
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
