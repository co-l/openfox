import type { ToolResult, Criterion } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'

function formatCriteriaList(criteria: Criterion[]): string {
  if (criteria.length === 0) return 'No criteria defined.'
  return criteria.map((c, i) => `${i + 1}. [${c.id}] ${c.description}`).join('\n')
}

type CriterionAction = 'get' | 'add' | 'update' | 'remove' | 'complete' | 'pass' | 'fail'

export const criterionTool: Tool = {
  name: 'criterion',
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
            description: 'Criterion ID (required for: update, remove, complete, pass, fail)',
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
      
      if (!action || !['get', 'add', 'update', 'remove', 'complete', 'pass', 'fail'].includes(action)) {
        return {
          success: false,
          error: `Invalid action: ${action}. Must be one of: get, add, update, remove, complete, pass, fail`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      const session = context.sessionManager.requireSession(context.sessionId)
      
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
        
        const criterion: Criterion = {
          id,
          description,
          status: { type: 'pending' },
          attempts: [],
        }
        
        const result = context.sessionManager.addCriterion(context.sessionId, criterion)
        
        if ('error' in result) {
          return { success: false, error: result.error, durationMs: Date.now() - startTime, truncated: false }
        }
        
        const idNote = result.actualId !== id 
          ? ` (requested ID "${id}" was in use, using "${result.actualId}" instead)`
          : ''
        
        return {
          success: true,
          output: `Added criterion "${result.actualId}"${idNote}. Current criteria:\n${formatCriteriaList(result.criteria)}`,
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
        
        if (!session.criteria.find(c => c.id === id)) {
          return {
            success: false,
            error: `Criterion "${id}" not found`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
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
        
        if (!session.criteria.find(c => c.id === id)) {
          return {
            success: false,
            error: `Criterion "${id}" not found`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
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
        
        const criterion = session.criteria.find(c => c.id === id)
        if (!criterion) {
          return {
            success: false,
            error: `Criterion "${id}" not found. Available: ${session.criteria.map(c => c.id).join(', ')}`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
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
        
        const criterion = session.criteria.find(c => c.id === id)
        if (!criterion) {
          return {
            success: false,
            error: `Criterion "${id}" not found`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const status = {
          type: 'passed' as const,
          verifiedAt: new Date().toISOString(),
          ...(reason ? { reason } : {}),
        }
        
        context.sessionManager.updateCriterionStatus(context.sessionId, id, status)
        
        context.sessionManager.addCriterionAttempt(context.sessionId, id, {
          attemptNumber: criterion.attempts.length + 1,
          status: 'passed',
          timestamp: new Date().toISOString(),
          ...(reason && { details: reason }),
        })
        
        return {
          success: true,
          output: `Criterion "${id}" verified as PASSED.${reason ? ` Verification: ${reason}` : ''}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
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
        
        const criterion = session.criteria.find(c => c.id === id)
        if (!criterion) {
          return {
            success: false,
            error: `Criterion "${id}" not found`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const status = {
          type: 'failed' as const,
          failedAt: new Date().toISOString(),
          reason,
        }
        
        context.sessionManager.updateCriterionStatus(context.sessionId, id, status)
        
        context.sessionManager.addCriterionAttempt(context.sessionId, id, {
          attemptNumber: criterion.attempts.length + 1,
          status: 'failed',
          timestamp: new Date().toISOString(),
          details: reason,
        })
        
        return {
          success: true,
          output: `Criterion "${id}" marked as FAILED. Reason: ${reason}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      return {
        success: false,
        error: 'Unexpected error',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }
  },
}
