import { createTool, requestUserConfirmation } from './tool-helpers.js'
import { getGitBranch, listWorkspaces } from '../git/workspace.js'

interface WorkspaceArgs {
  action: 'switch' | 'list' | 'delete'
  target?: string
  branch?: string
  sourceBranch?: string
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
        'You can also change the branch of the current workspace by calling switch with the current\n' +
        'workspace name and a branch parameter. The branch will be checked out without recreating\n' +
        'the workspace and without losing uncommitted changes.\n\n' +
        'If the requested branch does not exist, it will be created. By default it is based on the\n' +
        'default branch of the project (origin/HEAD). You can specify sourceBranch to base the new\n' +
        'branch on a different existing branch.\n\n' +
        'Actions that change the workspace (switch, delete) require explicit user approval via a confirmation dialog.\n\n' +
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
            description: 'Optional git branch to check out when creating or switching to a workspace',
          },
          sourceBranch: {
            type: 'string',
            description: 'If branch does not exist, base the new branch on this existing branch. Default: origin/HEAD.',
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

        const currentSession = sessionManager.getSession(sessionId)
        const isBranchChange =
          args.branch !== undefined &&
          currentSession != null &&
          args.target !== 'original' &&
          currentSession.workspace?.split('/').pop() === args.target

        const label = args.target === 'original' ? 'original project' : `workspace "${args.target}"`
        const desc = isBranchChange
          ? `Change branch to "${args.branch}" on ${label}`
          : `Switch to ${label}${args.branch ? ` on branch "${args.branch}"` : ''}`

        const approved = await requestUserConfirmation(context, 'workspace', desc)
        if (!approved) return helpers.error(`User denied: ${isBranchChange ? 'branch change' : `switch to ${label}`}`)

        const updated = await sessionManager.switchWorkspace(sessionId, args.target, args.branch, args.sourceBranch)
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
        if (args.target === 'original') return helpers.error('Cannot delete the original workspace')

        const approved = await requestUserConfirmation(context, 'workspace', `Delete workspace "${args.target}"`)
        if (!approved) return helpers.error(`User denied: delete workspace "${args.target}"`)

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
