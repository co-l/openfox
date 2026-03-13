import type { Criterion } from '@openfox/shared'
import type { LLMToolDefinition } from '../llm/types.js'

export function buildAgentSystemPrompt(
  criteria: Criterion[],
  tools: LLMToolDefinition[],
  modifiedFiles: string[]
): string {
  const criteriaList = criteria
    .map((c, i) => {
      const status = c.status.type === 'passed' ? '[DONE]' 
        : c.status.type === 'in_progress' ? '[IN PROGRESS]'
        : c.status.type === 'failed' ? '[FAILED]'
        : '[PENDING]'
      return `${i + 1}. ${status} ${c.description}`
    })
    .join('\n')
  
  const toolList = tools
    .map(t => `- ${t.function.name}: ${t.function.description}`)
    .join('\n')
  
  const filesModified = modifiedFiles.length > 0
    ? modifiedFiles.join(', ')
    : 'none yet'
  
  return `You are an expert software engineer. Your task is to satisfy the acceptance criteria below.

## ACCEPTANCE CRITERIA (CONTRACT)
${criteriaList}

## RULES
1. Work through criteria systematically, one at a time
2. Read files before modifying them to understand current state
3. After making changes, verify they work (run tests, type check, etc.)
4. If a tool fails, analyze the error and try a different approach
5. When you believe a criterion is satisfied, move to the next one
6. When ALL criteria are satisfied, output "ALL CRITERIA COMPLETE" and stop

## AVAILABLE TOOLS
${toolList}

## CURRENT STATE
Files modified this session: ${filesModified}

## IMPORTANT
- Focus on one criterion at a time
- Make minimal, focused changes
- Always test your changes when possible
- If stuck on a criterion after 3 attempts, ask the user for help`
}

export const AGENT_COMPLETION_CHECK = `Based on the current state, which acceptance criteria are now satisfied?

For each criterion, respond with:
- PASS: if the criterion is fully satisfied
- FAIL: if changes were attempted but don't satisfy the criterion
- PENDING: if the criterion hasn't been addressed yet

Be strict - only mark PASS if you're confident the requirement is met.`
