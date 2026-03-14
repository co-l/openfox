import type { ToolResult, CriterionStatus } from '@openfox/shared'
import type { Tool, ToolContext } from './types.js'
import { sessionManager } from '../session/index.js'

/**
 * complete_criterion - Builder marks a criterion as completed (awaiting verification)
 */
export const completeCriterionTool: Tool = {
  name: 'complete_criterion',
  definition: {
    type: 'function',
    function: {
      name: 'complete_criterion',
      description: 'Mark an acceptance criterion as completed. Call this when you have finished implementing a criterion. The verifier will later confirm it passes.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The criterion ID to mark as completed',
          },
          reason: {
            type: 'string',
            description: 'Brief explanation of how the criterion was satisfied',
          },
        },
        required: ['id'],
      },
    },
  },
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const id = args['id'] as string
      const reason = args['reason'] as string | undefined
      
      const session = sessionManager.requireSession(context.sessionId)
      const criterion = session.criteria.find(c => c.id === id)
      
      if (!criterion) {
        return {
          success: false,
          error: `Criterion not found: ${id}. Available: ${session.criteria.map(c => c.id).join(', ')}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      // Update status to completed
      const status: CriterionStatus = {
        type: 'completed',
        completedAt: new Date().toISOString(),
        reason,
      }
      
      sessionManager.updateCriterionStatus(context.sessionId, id, status)
      
      return {
        success: true,
        output: `Criterion "${id}" marked as completed.${reason ? ` Reason: ${reason}` : ''}`,
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

/**
 * pass_criterion - Verifier confirms a criterion passes verification
 */
export const passCriterionTool: Tool = {
  name: 'pass_criterion',
  definition: {
    type: 'function',
    function: {
      name: 'pass_criterion',
      description: 'Confirm that a criterion passes verification. Call this after verifying the implementation meets the requirement.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The criterion ID that passes verification',
          },
          reason: {
            type: 'string',
            description: 'How you verified this criterion passes',
          },
        },
        required: ['id'],
      },
    },
  },
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const id = args['id'] as string
      const reason = args['reason'] as string | undefined
      
      const session = sessionManager.requireSession(context.sessionId)
      const criterion = session.criteria.find(c => c.id === id)
      
      if (!criterion) {
        return {
          success: false,
          error: `Criterion not found: ${id}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      const status: CriterionStatus = {
        type: 'passed',
        verifiedAt: new Date().toISOString(),
        reason,
      }
      
      sessionManager.updateCriterionStatus(context.sessionId, id, status)
      
      // Record the verification attempt
      sessionManager.addCriterionAttempt(context.sessionId, id, {
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

/**
 * fail_criterion - Verifier marks a criterion as failed
 */
export const failCriterionTool: Tool = {
  name: 'fail_criterion',
  definition: {
    type: 'function',
    function: {
      name: 'fail_criterion',
      description: 'Mark a criterion as failed during verification. Provide a clear reason so the builder can fix it.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The criterion ID that failed verification',
          },
          reason: {
            type: 'string',
            description: 'Why the criterion failed verification - be specific so it can be fixed',
          },
        },
        required: ['id', 'reason'],
      },
    },
  },
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const id = args['id'] as string
      const reason = args['reason'] as string
      
      const session = sessionManager.requireSession(context.sessionId)
      const criterion = session.criteria.find(c => c.id === id)
      
      if (!criterion) {
        return {
          success: false,
          error: `Criterion not found: ${id}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      const status: CriterionStatus = {
        type: 'failed',
        failedAt: new Date().toISOString(),
        reason,
      }
      
      sessionManager.updateCriterionStatus(context.sessionId, id, status)
      
      // Record the verification attempt
      sessionManager.addCriterionAttempt(context.sessionId, id, {
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
