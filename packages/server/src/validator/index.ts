import { readFile } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import type { ValidationResult, CriterionValidation, Criterion } from '@openfox/shared'
import type { LLMClient } from '../llm/types.js'
import { sessionManager } from '../session/index.js'
import { buildValidationPrompt } from './prompts.js'
import { logger } from '../utils/logger.js'

export interface ValidatorOptions {
  sessionId: string
  llmClient: LLMClient
}

export async function validate(options: ValidatorOptions): Promise<ValidationResult> {
  const { sessionId, llmClient } = options
  
  const session = sessionManager.requireSession(sessionId)
  
  logger.info('Starting validation', { sessionId, criteria: session.criteria.length })
  
  // Get criteria that need verification (not already passed)
  const pendingCriteria = session.criteria.filter(c => c.status.type !== 'passed')
  
  if (pendingCriteria.length === 0) {
    // All criteria already passed
    return {
      allPassed: true,
      results: session.criteria.map(c => ({
        criterionId: c.id,
        status: 'pass' as const,
        reasoning: 'Previously verified',
        issues: [],
      })),
    }
  }
  
  // Get modified files content for context
  const modifiedFiles = session.executionState?.modifiedFiles ?? []
  const fileContents = new Map<string, string>()
  
  for (const filePath of modifiedFiles) {
    try {
      const fullPath = isAbsolute(filePath) ? filePath : resolve(session.workdir, filePath)
      const content = await readFile(fullPath, 'utf-8')
      fileContents.set(filePath, content)
    } catch {
      // File might have been deleted, skip
    }
  }
  
  // Use LLM to verify all pending criteria based on their descriptions
  const prompt = buildValidationPrompt(pendingCriteria, fileContents)
  
  const response = await llmClient.complete({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    maxTokens: 4000,
  })
  
  // Parse validation results
  let results: CriterionValidation[]
  try {
    let jsonStr = response.content
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1]!
    }
    
    const parsed = JSON.parse(jsonStr.trim()) as {
      results: Array<{
        criterionId: string
        status: 'pass' | 'fail'
        reasoning: string
        issues: string[]
      }>
    }
    
    results = parsed.results
  } catch (error) {
    logger.error('Failed to parse validation results', { error, content: response.content })
    
    // Assume all fail if we can't parse
    results = pendingCriteria.map(c => ({
      criterionId: c.id,
      status: 'fail' as const,
      reasoning: 'Failed to parse validation response',
      issues: ['Validation error'],
    }))
  }
  
  // Update criterion statuses
  for (const result of results) {
    const status: Criterion['status'] = result.status === 'pass'
      ? { type: 'passed', verifiedAt: new Date().toISOString() }
      : { type: 'failed', reason: result.issues.join('; ') || result.reasoning, failedAt: new Date().toISOString() }
    
    sessionManager.updateCriterionStatus(sessionId, result.criterionId, status)
  }
  
  // Build final results including already-passed criteria
  const finalSession = sessionManager.requireSession(sessionId)
  const allResults: CriterionValidation[] = finalSession.criteria.map(c => {
    const modelResult = results.find(r => r.criterionId === c.id)
    if (modelResult) return modelResult
    
    // Already-passed criterion
    return {
      criterionId: c.id,
      status: 'pass' as const,
      reasoning: 'Previously verified',
      issues: [],
    }
  })
  
  const allPassed = allResults.every(r => r.status === 'pass')
  
  // Update phase based on results
  if (allPassed) {
    sessionManager.setPhase(sessionId, 'done')
  } else {
    // Go back to building
    sessionManager.setPhase(sessionId, 'build')
  }
  
  return { allPassed, results: allResults }
}

export { buildValidationPrompt } from './prompts.js'
