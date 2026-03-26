/**
 * Sub-Agent Context Builders
 *
 * Standalone functions that build fresh context messages for sub-agents.
 * These extract relevant data from session state into user messages.
 */

import type { Session } from '../../shared/types.js'
import type { RequestContextMessage } from '../chat/request-context.js'

/**
 * Build verifier context messages from session state.
 * Creates structured context with task summary, criteria, and modified files.
 */
export function buildVerifierContextMessages(session: Session, prompt: string): RequestContextMessage[] {
  const summary = session.summary ?? 'No summary available'
  const modifiedFiles = session.executionState?.modifiedFiles ?? []

  const criteriaList = session.criteria
    .map(c => {
      const status = c.status.type === 'passed' ? '[PASSED]'
        : c.status.type === 'completed' ? '[NEEDS VERIFICATION]'
        : c.status.type === 'failed' ? '[FAILED]'
        : '[NOT COMPLETED]'
      return `- **${c.id}** ${status}: ${c.description}`
    })
    .join('\n')

  const contextContent = `## Task Summary
${summary}

## Criteria
${criteriaList}

## Modified Files
${modifiedFiles.length > 0 ? modifiedFiles.map(f => `- ${f}`).join('\n') : '(none)'}`

  return [
    { role: 'user', content: contextContent, source: 'runtime' },
    { role: 'user', content: prompt, source: 'runtime' },
  ]
}

/**
 * Build code reviewer context messages from session state.
 */
export function buildCodeReviewerContextMessages(session: Session, prompt: string): RequestContextMessage[] {
  const modifiedFiles = session.executionState?.modifiedFiles ?? []

  const contextContent = `## Modified Files
${modifiedFiles.length > 0 ? modifiedFiles.map(f => `- ${f}`).join('\n') : '(none)'}

## Task
${prompt}`

  return [
    { role: 'user', content: contextContent, source: 'runtime' },
  ]
}

/**
 * Build simple prompt-only context messages (test_generator, debugger, etc.)
 */
export function buildSimpleContextMessages(prompt: string): RequestContextMessage[] {
  const contextContent = `## Task
${prompt}`

  return [
    { role: 'user', content: contextContent, source: 'runtime' },
  ]
}

/**
 * Get the appropriate context builder for a sub-agent by ID.
 * Returns context messages for the sub-agent's fresh context.
 */
export function buildSubAgentContextMessages(
  agentId: string,
  session: Session,
  prompt: string,
): RequestContextMessage[] {
  switch (agentId) {
    case 'verifier':
      return buildVerifierContextMessages(session, prompt)
    case 'code_reviewer':
      return buildCodeReviewerContextMessages(session, prompt)
    default:
      return buildSimpleContextMessages(prompt)
  }
}
