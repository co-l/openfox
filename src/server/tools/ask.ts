import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import { createDeferred } from '../utils/async.js'

// Store pending questions by call ID
const pendingQuestions = new Map<string, {
  promise: Promise<string>
  resolve: (answer: string) => void
  reject: (error: Error) => void
  sessionId: string
}>()

export const askUserTool: Tool = {
  name: 'ask_user',
  definition: {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Pause execution and ask the user a question. Use this when you need clarification or user input before proceeding.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user',
          },
        },
        required: ['question'],
      },
    },
  },
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const question = args['question'] as string
    
    // Generate a unique ID for this question
    const callId = crypto.randomUUID()
    
    // Create a deferred promise for the answer
    const deferred = createDeferred<string>()
    void deferred.promise.catch(() => {})
    
    pendingQuestions.set(callId, {
      promise: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
      sessionId: context.sessionId,
    })
    
    // The agent runner will see this and pause execution,
    // sending an event to the client with the question and callId
    
    // This is a special case - we throw a custom error that the agent runner catches
    throw new AskUserInterrupt(callId, question)
  },
}

// Custom error class for ask_user interrupts
export class AskUserInterrupt extends Error {
  constructor(
    public readonly callId: string,
    public readonly question: string
  ) {
    super('Ask user interrupt')
    this.name = 'AskUserInterrupt'
  }
}

// Function to provide the answer (called by the WebSocket handler)
export function provideAnswer(callId: string, answer: string): boolean {
  const pending = pendingQuestions.get(callId)
  if (!pending) {
    return false
  }
  
  pending.resolve(answer)
  pendingQuestions.delete(callId)
  return true
}

// Function to cancel a pending question
export function cancelQuestion(callId: string, reason: string): boolean {
  const pending = pendingQuestions.get(callId)
  if (!pending) {
    return false
  }
  
  pending.reject(new Error(reason))
  pendingQuestions.delete(callId)
  return true
}

export function cancelQuestionsForSession(sessionId: string, reason: string): number {
  let cancelledCount = 0

  for (const [callId, pending] of pendingQuestions.entries()) {
    if (pending.sessionId !== sessionId) {
      continue
    }

    pending.reject(new Error(reason))
    pendingQuestions.delete(callId)
    cancelledCount += 1
  }

  return cancelledCount
}

// Check if there's a pending question
export function hasPendingQuestion(callId: string): boolean {
  return pendingQuestions.has(callId)
}

// Await the answer for a pending question
export function awaitAnswer(callId: string): Promise<string> | null {
  const pending = pendingQuestions.get(callId)
  return pending?.promise ?? null
}
