import type { ToolResult, Criterion } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import { validateAction, checkActionPermission, requireSession, unexpectedError, catchError } from './tool-helpers.js'

function formatCriteriaList(criteria: Criterion[]): string {
  if (criteria.length === 0) return 'No criteria defined.'
  return criteria.map((c, i) => `${i + 1}. [${c.id}] ${c.description}`).join('\n')
}

function requireCriterionExists(session: { criteria: Array<{ id: string }> }, id: string, startTime: number): ToolResult | null {
  if (!session.criteria.find(c => c.id === id)) {
    return {
      success: false,
      error: `Criterion "${id}" not found`,
      durationMs: Date.now() - startTime,
      truncated: false,
    }
  }
  return null
}

function completeCriterion(
  session: { criteria: Criterion[] },
  context: ToolContext,
  id: string,
  statusType: 'passed' | 'failed',
  reason: string | undefined,
  startTime: number
): ToolResult {
  const { criterion, error: notFoundError } = findCriterion(session, id, startTime)
  if (notFoundError) return notFoundError

  const status = statusType === 'passed'
    ? { type: 'passed' as const, verifiedAt: new Date().toISOString(), ...(reason && { reason }) }
    : { type: 'failed' as const, failedAt: new Date().toISOString(), reason: reason! }

  context.sessionManager.updateCriterionStatus(context.sessionId, id, status)

  context.sessionManager.addCriterionAttempt(context.sessionId, id, {
    attemptNumber: criterion!.attempts.length + 1,
    status: statusType,
    timestamp: new Date().toISOString(),
    ...(reason ? { details: reason } : {}),
  })

  return {
    success: true,
    output: statusType === 'passed'
      ? `Criterion "${id}" verified as PASSED.${reason ? ` Verification: ${reason}` : ''}`
      : `Criterion "${id}" marked as FAILED. Reason: ${reason}`,
    durationMs: Date.now() - startTime,
    truncated: false,
  }
}

function findCriterion(session: { criteria: Criterion[] }, id: string, startTime: number, errorMessage?: string): { criterion: Criterion | undefined; error: ToolResult | null } {
  const criterion = session.criteria.find(c => c.id === id)
  if (!criterion) {
    return {
      criterion: undefined,
      error: {
        success: false,
        error: errorMessage ?? `Criterion "${id}" not found`,
        durationMs: Date.now() - startTime,
        truncated: false,
      },
    }
  }
  return { criterion, error: null }
}

type CriterionAction = 'get' | 'add' | 'update' | 'remove' | 'complete' | 'pass' | 'fail'

export const criterionTool: Tool = {
  name: 'criterion',
  permittedActions: ['get', 'add', 'update', 'remove', 'complete', 'pass', 'fail'],
  definition: {
    type: 'function',
    function: {
      name: 'criterion',
      description: 'Manage acceptance criteria. Actions: get (list all), add (create new), update (modify), remove (delete), complete (mark done), pass (verify), fail (reject).',
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
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const action = args['action'] as CriterionAction | undefined
      const id = args['id'] as string | undefined
      const description = args['description'] as string | undefined
      const reason = args['reason'] as string | undefined
      
      const allowedActions = ['get', 'add', 'update', 'remove', 'complete', 'pass', 'fail']
      const actionError = validateAction(action, allowedActions, startTime)
      if (actionError) return actionError

      const permittedActions = context.permittedActions?.['criterion']
      const permissionError = checkActionPermission(action, permittedActions, startTime)
      if (permissionError) return permissionError
      
      const session = requireSession(context.sessionManager, context.sessionId)
      
      if (action === 'get') {
        const criteria = session.criteria
        return {
          success: true,
          output: criteria.length === 0
            ? 'No criteria defined yet.'
            : JSON.stringify(criteria.map(c => ({
                id: c.id,
                description: c.description,
              })), null, 2),
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      if (action === 'add') {
        if (!description) {
          return {
            success: false,
            error: 'Missing required field: description',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const criterion: Criterion = {
          id: id || '',
          description,
          status: { type: 'pending' },
          attempts: [],
        }
        
        const result = context.sessionManager.addCriterion(context.sessionId, criterion)
        
        if ('error' in result) {
          return { success: false, error: result.error, durationMs: Date.now() - startTime, truncated: false }
        }
        
        return {
          success: true,
          output: `Added criterion "${result.actualId}". Current criteria:\n${formatCriteriaList(result.criteria)}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      if (action === 'update') {
        if (!id) {
          return {
            success: false,
            error: 'Missing required field: id',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        if (!description) {
          return {
            success: false,
            error: 'Missing required field: description',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const notFoundError = requireCriterionExists(session, id, startTime)
        if (notFoundError) return notFoundError

        const criteria = context.sessionManager.updateCriterionFull(context.sessionId, id, { description })
        return {
          success: true,
          output: `Updated criterion "${id}". Current criteria:\n${formatCriteriaList(criteria)}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      if (action === 'remove') {
        if (!id) {
          return {
            success: false,
            error: 'Missing required field: id',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const notFoundError = requireCriterionExists(session, id, startTime)
        if (notFoundError) return notFoundError

        const criteria = context.sessionManager.removeCriterion(context.sessionId, id)
        return {
          success: true,
          output: criteria.length === 0
            ? `Removed criterion "${id}". No criteria remaining.`
            : `Removed criterion "${id}". Current criteria:\n${formatCriteriaList(criteria)}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      if (action === 'complete') {
        if (!id) {
          return {
            success: false,
            error: 'Missing required field: id',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const { error: notFoundError } = findCriterion(session, id, startTime, `Criterion "${id}" not found. Available: ${session.criteria.map(c => c.id).join(', ')}`)
        if (notFoundError) return notFoundError

        const status = {
          type: 'completed' as const,
          completedAt: new Date().toISOString(),
          ...(reason ? { reason } : {}),
        }

        context.sessionManager.updateCriterionStatus(context.sessionId, id, status)

        return {
          success: true,
          output: `Criterion "${id}" marked as completed.${reason ? ` Reason: ${reason}` : ''}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }

      if (action === 'pass') {
        if (!id) {
          return {
            success: false,
            error: 'Missing required field: id',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        return completeCriterion(session, context, id, 'passed', reason, startTime)
      }
      
      if (action === 'fail') {
        if (!id) {
          return {
            success: false,
            error: 'Missing required field: id',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        if (!reason) {
          return {
            success: false,
            error: 'Missing required field: reason',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        return completeCriterion(session, context, id, 'failed', reason, startTime)
      }
      
      return unexpectedError(startTime)
    } catch (error) {
      return catchError(error, startTime)
    }
  },
}
