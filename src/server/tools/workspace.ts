import { createTool } from './tool-helpers.js'
import { getGitBranch, listWorkspaces } from '../git/workspace.js'

interface WorkspaceArgs {
  action: 'switch' | 'list' | 'delete'
  target?: string
  branch?: string
}

export const workspaceTool = createTool<WorkspaceArgs>(
  'workspace',
  {
    type: 'function',
    function: {
      name: 'workspace',
      description:
        'Manage workspaces for the current session. A workspace is a cloned copy of the project.\n\n' +
        'Use "switch" to move between workspaces. Target "original" for the project root, or a workspace name.\n' +
        'If the workspace does not exist yet, it is created automatically.\n\n' +
        'Setup commands (e.g. npm install) are configured via .openfox/workspace.json.\n\n' +
        'Actions:\n' +
        '- switch: Switch to a workspace (target: "original" or a name, optional branch for new workspaces)\n' +
        '- list: List all workspaces with their current branch and active status\n' +
        '- delete: Delete a workspace by name (cannot delete "original")',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['switch', 'list', 'delete'],
            description: 'The action to perform',
          },
          target: {
            type: 'string',
            description: 'For switch: "original" or a workspace name. For delete: the workspace name to delete.',
          },
          branch: {
            type: 'string',
            description: 'Optional git branch to check out when creating a new workspace',
          },
        },
        required: ['action'],
      },
    },
  },
  async (args, context, helpers) => {
    const { sessionId, sessionManager } = context

    const validActions = ['switch', 'list', 'delete'] as const
    if (!validActions.includes(args.action as (typeof validActions)[number])) {
      return helpers.error(`Invalid action: ${args.action}. Must be one of: ${validActions.join(', ')}`)
    }

    switch (args.action) {
      case 'switch': {
        if (!args.target || typeof args.target !== 'string') {
          return helpers.error('Parameter "target" is required for action=switch ("original" or a workspace name)')
        }

        const updated = await sessionManager.switchWorkspace(sessionId, args.target, args.branch)
        const wsName = args.target === 'original' ? 'original' : (updated.workspace?.split('/').pop() ?? args.target)
        const branch = await getGitBranch(updated.workspace ?? updated.workdir)
        return helpers.success(
          JSON.stringify(
            {
              workspace: wsName,
              path: updated.workspace ?? updated.workdir,
              branch,
              message:
                args.target === 'original'
                  ? 'Switched to original project'
                  : `Switched to workspace "${wsName}" on branch "${branch ?? 'unknown'}"`,
            },
            null,
            2,
          ),
        )
      }

      case 'list': {
        const session = sessionManager.getSession(sessionId)
        if (!session) return helpers.error('Session not found')

        const project = sessionManager.getProject(session.projectId)
        if (!project) return helpers.error('Project not found')

        const currentBranch = await getGitBranch(session.workspace ?? session.workdir)
        const named = await listWorkspaces(project.name)
        const activeWsName = session.workspace?.split('/').pop() ?? null

        const workspaces = [
          { name: 'original', branch: currentBranch, active: !session.workspace },
          ...named.map((ws) => ({
            name: ws.name,
            branch: ws.branch,
            active: ws.name === activeWsName,
          })),
        ]

        return helpers.success(JSON.stringify({ workspaces }, null, 2))
      }

      case 'delete': {
        if (!args.target || typeof args.target !== 'string') {
          return helpers.error('Parameter "target" is required for action=delete (the workspace name)')
        }
        if (args.target === 'original') {
          return helpers.error('Cannot delete the original workspace')
        }

        await sessionManager.deleteWorkspace(sessionId, args.target)
        return helpers.success(
          JSON.stringify(
            {
              workspace: args.target,
              message: `Workspace "${args.target}" has been deleted`,
            },
            null,
            2,
          ),
        )
      }

      default:
        return helpers.error(`Unknown action: ${args.action}`)
    }
  },
)
