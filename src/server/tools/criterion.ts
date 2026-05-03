import type { Criterion } from '../../shared/types.js'
import type { ToolContext } from './types.js'
import { createTool, validateActionWithPermission, requireSession } from './tool-helpers.js'

function formatCriteriaList(criteria: Criterion[]): string {
  if (criteria.length === 0) return 'No criteria defined.'
  return criteria.map((c, i) => `${i + 1}. [${c.id}] ${c.description}`).join('\n')
}

function completeCriterion(
  session: { criteria: Criterion[] },
  context: ToolContext,
  id: string,
  statusType: 'passed' | 'failed',
  reason: string | undefined,
): { success: boolean; output: string } {
  const criterion = session.criteria.find((c) => c.id === id)
  if (!criterion) {
    return { success: false, output: `Criterion "${id}" not found` }
  }

  const status =
    statusType === 'passed'
      ? { type: 'passed' as const, verifiedAt: new Date().toISOString(), ...(reason && { reason }) }
      : { type: 'failed' as const, failedAt: new Date().toISOString(), reason: reason! }

  context.sessionManager.updateCriterionStatus(context.sessionId, id, status)
  context.sessionManager.addCriterionAttempt(context.sessionId, id, {
    attemptNumber: criterion.attempts.length + 1,
    status: statusType,
    timestamp: new Date().toISOString(),
    ...(reason ? { details: reason } : {}),
  })

  return {
    success: true,
    output:
      statusType === 'passed'
        ? `Criterion "${id}" verified as PASSED.${reason ? ` Verification: ${reason}` : ''}`
        : `Criterion "${id}" marked as FAILED. Reason: ${reason}`,
  }
}

interface CriterionArgs {
  action: 'get' | 'add' | 'update' | 'remove' | 'complete' | 'pass' | 'fail'
  id?: string
  description?: string
  reason?: string
}

export const criterionTool = createTool<CriterionArgs>(
  'criterion',
  {
    type: 'function',
    function: {
      name: 'criterion',
      description:
        'Manage acceptance criteria. Actions: get (list all), add (create new), update (modify), remove (delete), complete (mark done), pass (verify), fail (reject).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'add', 'update', 'remove', 'complete', 'pass', 'fail'],
            description: 'The action to perform',
          },
          id: {
            type: 'string',
            description: 'Criterion ID (required for: update, remove, complete, pass, fail; auto-generated for add)',
          },
          description: {
            type: 'string',
            description: 'Criterion description (required for: add, update)',
          },
          reason: {
            type: 'string',
            description: 'Reason (required for: fail; optional for: complete, pass)',
          },
        },
        required: ['action'],
      },
    },
  },
  async (args, context, helpers) => {
    const actionError = validateActionWithPermission(
      args.action,
      ['get', 'add', 'update', 'remove', 'complete', 'pass', 'fail'],
      'criterion',
      context.permittedActions,
    )
    if (actionError) return actionError

    const session = requireSession(context.sessionManager, context.sessionId)

    if (args.action === 'get') {
      return helpers.success(
        session.criteria.length === 0
          ? 'No criteria defined yet.'
          : JSON.stringify(
              session.criteria.map((c) => ({ id: c.id, description: c.description })),
              null,
              2,
            ),
      )
    }

    if (args.action === 'add') {
      if (!args.description) return helpers.error('Missing required field: description')
      const criterion: Criterion = {
        id: args.id || '',
        description: args.description,
        status: { type: 'pending' },
        attempts: [],
      }
      const result = context.sessionManager.addCriterion(context.sessionId, criterion)
      if ('error' in result) return helpers.error(result.error)
      return helpers.success(
        `Added criterion "${result.actualId}". Current criteria:\n${formatCriteriaList(result.criteria)}`,
      )
    }

    if (args.action === 'update') {
      if (!args.id) return helpers.error('Missing required field: id')
      if (!args.description) return helpers.error('Missing required field: description')
      if (!session.criteria.find((c) => c.id === args.id)) return helpers.error(`Criterion "${args.id}" not found`)
      const criteria = context.sessionManager.updateCriterionFull(context.sessionId, args.id, {
        description: args.description,
      })
      return helpers.success(`Updated criterion "${args.id}". Current criteria:\n${formatCriteriaList(criteria)}`)
    }

    if (args.action === 'remove') {
      if (!args.id) return helpers.error('Missing required field: id')
      if (!session.criteria.find((c) => c.id === args.id)) return helpers.error(`Criterion "${args.id}" not found`)
      const criteria = context.sessionManager.removeCriterion(context.sessionId, args.id)
      return helpers.success(
        criteria.length === 0
          ? `Removed criterion "${args.id}". No criteria remaining.`
          : `Removed criterion "${args.id}". Current criteria:\n${formatCriteriaList(criteria)}`,
      )
    }

    if (args.action === 'complete') {
      if (!args.id) return helpers.error('Missing required field: id')
      const criterion = session.criteria.find((c) => c.id === args.id)
      if (!criterion)
        return helpers.error(
          `Criterion "${args.id}" not found. Available: ${session.criteria.map((c) => c.id).join(', ')}`,
        )
      context.sessionManager.updateCriterionStatus(context.sessionId, args.id, {
        type: 'completed' as const,
        completedAt: new Date().toISOString(),
        ...(args.reason ? { reason: args.reason } : {}),
      })
      return helpers.success(
        `Criterion "${args.id}" marked as completed.${args.reason ? ` Reason: ${args.reason}` : ''}`,
      )
    }

    if (args.action === 'pass') {
      if (!args.id) return helpers.error('Missing required field: id')
      const result = completeCriterion(session, context, args.id, 'passed', args.reason)
      return result.success ? helpers.success(result.output) : helpers.error(result.output)
    }

    if (args.action === 'fail') {
      if (!args.id) return helpers.error('Missing required field: id')
      if (!args.reason) return helpers.error('Missing required field: reason')
      const result = completeCriterion(session, context, args.id, 'failed', args.reason)
      return result.success ? helpers.success(result.output) : helpers.error(result.output)
    }

    return helpers.error('Unexpected error')
  },
)
