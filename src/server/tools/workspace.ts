import { createTool } from './tool-helpers.js'
import { listBranches, getGitBranch } from '../git/workspace.js'

interface WorkspaceArgs {
  action: 'switch' | 'status' | 'list_branches'
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
        '- status: Show current workspace state (name, path, branch)\n' +
        '- list_branches: List local git branches for the current project',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['switch', 'status', 'list_branches'],
            description: 'The action to perform',
          },
          target: {
            type: 'string',
            description:
              '"original" to return to project root, or a workspace name to switch to (required for action=switch)',
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

    const validActions = ['switch', 'status', 'list_branches'] as const
    if (!validActions.includes(args.action as (typeof validActions)[number])) {
      return helpers.error(`Invalid action: ${args.action}. Must be one of: ${validActions.join(', ')}`)
    }

    switch (args.action) {
      case 'list_branches': {
        const session = sessionManager.getSession(sessionId)
        if (!session) return helpers.error('Session not found')

        const project = sessionManager.getProject(session.projectId)
        if (!project) return helpers.error('Project not found')

        const branches = await listBranches(project.workdir)
        return helpers.success(JSON.stringify({ branches }, null, 2))
      }

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

      case 'status': {
        const session = sessionManager.getSession(sessionId)
        if (!session) return helpers.error('Session not found')

        const active = !!session.workspace
        const wsName = active ? session.workspace!.split('/').pop() : 'original'
        const branch = await getGitBranch(session.workspace ?? session.workdir)
        return helpers.success(
          JSON.stringify(
            {
              workspace: wsName,
              path: session.workspace ?? session.workdir,
              workdir: session.workdir,
              branch,
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
