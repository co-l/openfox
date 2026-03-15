import type { Criterion } from '@openfox/shared'
import type { Tool } from './types.js'
import { sessionManager } from '../session/index.js'

function formatCriteriaList(criteria: Criterion[]): string {
  if (criteria.length === 0) return 'No criteria defined.'
  return criteria.map((c, i) => `${i + 1}. [${c.id}] ${c.description}`).join('\n')
}

export const getCriteriaTool: Tool = {
  name: 'get_criteria',
  definition: {
    type: 'function',
    function: {
      name: 'get_criteria',
      description: 'Get the current acceptance criteria list, including any user edits. Always call this before modifying criteria.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  execute: async (_args, context) => {
    const session = sessionManager.requireSession(context.sessionId)
    const criteria = session.criteria
    
    return {
      success: true,
      output: criteria.length === 0
        ? 'No criteria defined yet.'
        : JSON.stringify(criteria.map(c => ({
            id: c.id,
            description: c.description,
          })), null, 2),
      durationMs: 0,
      truncated: false,
    }
  },
}

export const addCriterionTool: Tool = {
  name: 'add_criterion',
  definition: {
    type: 'function',
    function: {
      name: 'add_criterion',
      description: 'Add a new acceptance criterion.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Unique semantic identifier (e.g., "tests-pass", "api-returns-jwt")',
          },
          description: {
            type: 'string',
            description: 'Self-contained, verifiable requirement. Include how to verify it.',
          },
        },
        required: ['id', 'description'],
      },
    },
  },
  execute: async (args, context) => {
    const { id, description } = args as { id: string; description: string }
    
    if (!id || typeof id !== 'string') {
      return { success: false, error: 'id is required', durationMs: 0, truncated: false }
    }
    if (!description || typeof description !== 'string') {
      return { success: false, error: 'description is required', durationMs: 0, truncated: false }
    }
    
    sessionManager.requireSession(context.sessionId)
    
    const criterion: Criterion = {
      id,
      description,
      status: { type: 'pending' },
      attempts: [],
    }
    
    const result = sessionManager.addCriterion(context.sessionId, criterion)
    
    if ('error' in result) {
      return { success: false, error: result.error, durationMs: 0, truncated: false }
    }
    
    const idNote = result.actualId !== id 
      ? ` (requested ID "${id}" was in use, using "${result.actualId}" instead)`
      : ''
    
    return {
      success: true,
      output: `Added criterion "${result.actualId}"${idNote}. Current criteria:\n${formatCriteriaList(result.criteria)}`,
      durationMs: 0,
      truncated: false,
    }
  },
}

export const updateCriterionTool: Tool = {
  name: 'update_criterion',
  definition: {
    type: 'function',
    function: {
      name: 'update_criterion',
      description: 'Update an existing criterion by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'ID of the criterion to update',
          },
          description: {
            type: 'string',
            description: 'New description',
          },
        },
        required: ['id'],
      },
    },
  },
  execute: async (args, context) => {
    const { id, description } = args as { id: string; description?: string }
    
    if (!id) {
      return { success: false, error: 'id is required', durationMs: 0, truncated: false }
    }
    
    const session = sessionManager.requireSession(context.sessionId)
    
    if (!session.criteria.find(c => c.id === id)) {
      return { success: false, error: `criterion "${id}" not found`, durationMs: 0, truncated: false }
    }
    
    if (!description) {
      return { success: false, error: 'description is required for update', durationMs: 0, truncated: false }
    }
    
    const criteria = sessionManager.updateCriterionFull(context.sessionId, id, { description })
    return {
      success: true,
      output: `Updated criterion "${id}". Current criteria:\n${formatCriteriaList(criteria)}`,
      durationMs: 0,
      truncated: false,
    }
  },
}

export const removeCriterionTool: Tool = {
  name: 'remove_criterion',
  definition: {
    type: 'function',
    function: {
      name: 'remove_criterion',
      description: 'Remove a criterion by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'ID of the criterion to remove',
          },
        },
        required: ['id'],
      },
    },
  },
  execute: async (args, context) => {
    const { id } = args as { id: string }
    
    if (!id) {
      return { success: false, error: 'id is required', durationMs: 0, truncated: false }
    }
    
    const session = sessionManager.requireSession(context.sessionId)
    
    if (!session.criteria.find(c => c.id === id)) {
      return { success: false, error: `criterion "${id}" not found`, durationMs: 0, truncated: false }
    }
    
    const criteria = sessionManager.removeCriterion(context.sessionId, id)
    return {
      success: true,
      output: criteria.length === 0
        ? `Removed criterion "${id}". No criteria remaining.`
        : `Removed criterion "${id}". Current criteria:\n${formatCriteriaList(criteria)}`,
      durationMs: 0,
      truncated: false,
    }
  },
}
