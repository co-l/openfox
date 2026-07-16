import { createTool } from './tool-helpers.js'
import { listBranches } from '../git/worktree.js'

interface WorktreeArgs {
  action: 'list_branches' | 'create' | 'attach' | 'close' | 'status'
  name?: string
  path?: string
}

export const worktreeTool = createTool<WorktreeArgs>(
  'worktree',
  {
    type: 'function',
    function: {
      name: 'worktree',
      description:
        'Manage git worktrees for the current session. Use this to work on isolated branches without affecting the main working tree.\n\n' +
        'Actions:\n' +
        '- list_branches: List local git branches for the current project\n' +
        '- create: Create a new branch + git worktree and attach this session to it (provide: name)\n' +
        '- attach: Attach this session to an existing git worktree by path (provide: path)\n' +
        '- close: Close the current worktree and return the session to the project root\n' +
        '- status: Show current worktree state (active branch, worktree path)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list_branches', 'create', 'attach', 'close', 'status'],
            description: 'The action to perform',
          },
          name: {
            type: 'string',
            description: 'Branch name for creating a new worktree (required for action=create)',
          },
          path: {
            type: 'string',
            description: 'Path to an existing worktree directory (required for action=attach)',
          },
        },
        required: ['action'],
      },
    },
  },
  async (args, context, helpers) => {
    const { sessionId, sessionManager } = context

    const validActions = ['list_branches', 'create', 'attach', 'close', 'status'] as const
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

      case 'create': {
        if (!args.name || typeof args.name !== 'string') {
          return helpers.error('Parameter "name" is required for action=create (the branch name)')
        }

        const updated = await sessionManager.createSessionWorktree(sessionId, args.name)
        return helpers.success(
          JSON.stringify(
            {
              worktree: updated.worktree,
              branch: args.name,
              message: `Worktree created and session attached to branch "${args.name}"`,
            },
            null,
            2,
          ),
        )
      }

      case 'attach': {
        if (!args.path || typeof args.path !== 'string') {
          return helpers.error('Parameter "path" is required for action=attach (path to existing worktree)')
        }

        const updated = await sessionManager.attachSessionWorktree(sessionId, args.path)
        return helpers.success(
          JSON.stringify(
            {
              worktree: updated.worktree,
              message: `Session attached to existing worktree at ${args.path}`,
            },
            null,
            2,
          ),
        )
      }

      case 'close': {
        const updated = await sessionManager.closeSessionWorktree(sessionId)
        return helpers.success(
          JSON.stringify(
            {
              worktree: updated.worktree,
              workdir: updated.workdir,
              message: 'Worktree closed. Session returned to project root.',
            },
            null,
            2,
          ),
        )
      }

      case 'status': {
        const session = sessionManager.getSession(sessionId)
        if (!session) return helpers.error('Session not found')

        const active = !!session.worktree
        return helpers.success(
          JSON.stringify(
            {
              active,
              worktree: session.worktree ?? null,
              workdir: session.workdir,
              ...(active ? { branch: session.worktree?.split('/worktrees/')[1] ?? session.worktree } : {}),
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
