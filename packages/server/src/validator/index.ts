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
  
  // First, run auto-verification for criteria with commands
  const autoCriteria = session.criteria.filter(c => c.verification.type === 'auto')
  for (const criterion of autoCriteria) {
    if (criterion.verification.type === 'auto') {
      const passed = await runAutoVerification(
        criterion.verification.command,
        session.workdir
      )
      
      if (passed) {
        sessionManager.updateCriterionStatus(sessionId, criterion.id, {
          type: 'passed',
          verifiedAt: new Date().toISOString(),
          verifiedBy: 'auto',
        })
      }
    }
  }
  
  // Get modified files content
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
  
  // Get criteria that need model verification
  const refreshedSession = sessionManager.requireSession(sessionId)
  const needsModelVerification = refreshedSession.criteria.filter(
    c => c.status.type !== 'passed' && c.verification.type === 'model'
  )
  
  if (needsModelVerification.length === 0 && autoCriteria.length === refreshedSession.criteria.length) {
    // All criteria either passed auto-verification or don't exist
    const allPassed = refreshedSession.criteria.every(c => c.status.type === 'passed')
    return {
      allPassed,
      results: refreshedSession.criteria.map(c => ({
        criterionId: c.id,
        status: c.status.type === 'passed' ? 'pass' : 'fail',
        reasoning: c.status.type === 'passed' 
          ? 'Passed auto-verification' 
          : 'Did not pass auto-verification',
        issues: c.status.type === 'failed' && c.status.type === 'failed' 
          ? [c.status.reason] 
          : [],
      })),
    }
  }
  
  // Use LLM for model-verified criteria (fresh context!)
  const prompt = buildValidationPrompt(
    refreshedSession.criteria.filter(c => c.status.type !== 'passed'),
    fileContents
  )
  
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
    results = refreshedSession.criteria
      .filter(c => c.status.type !== 'passed')
      .map(c => ({
        criterionId: c.id,
        status: 'fail' as const,
        reasoning: 'Failed to parse validation response',
        issues: ['Validation error'],
      }))
  }
  
  // Update criterion statuses
  for (const result of results) {
    const status: Criterion['status'] = result.status === 'pass'
      ? { type: 'passed', verifiedAt: new Date().toISOString(), verifiedBy: 'model' }
      : { type: 'failed', reason: result.issues.join('; ') || result.reasoning, failedAt: new Date().toISOString() }
    
    sessionManager.updateCriterionStatus(sessionId, result.criterionId, status)
  }
  
  // Include auto-verified results
  const finalSession = sessionManager.requireSession(sessionId)
  const allResults: CriterionValidation[] = finalSession.criteria.map(c => {
    const modelResult = results.find(r => r.criterionId === c.id)
    if (modelResult) return modelResult
    
    // Auto-verified criterion
    return {
      criterionId: c.id,
      status: c.status.type === 'passed' ? 'pass' as const : 'fail' as const,
      reasoning: c.status.type === 'passed' 
        ? 'Passed auto-verification'
        : (c.status.type === 'failed' ? c.status.reason : 'Not verified'),
      issues: [],
    }
  })
  
  const allPassed = allResults.every(r => r.status === 'pass')
  
  // Transition based on results
  if (allPassed) {
    sessionManager.transition(sessionId, 'completed')
  } else {
    // Go back to executing
    sessionManager.transition(sessionId, 'executing')
  }
  
  return { allPassed, results: allResults }
}

async function runAutoVerification(command: string, workdir: string): Promise<boolean> {
  try {
    const { spawn } = await import('node:child_process')
    
    return new Promise((resolve) => {
      const proc = spawn('sh', ['-c', command], {
        cwd: workdir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      })
      
      proc.on('close', (code) => {
        resolve(code === 0)
      })
      
      proc.on('error', () => {
        resolve(false)
      })
    })
  } catch {
    return false
  }
}

export { buildValidationPrompt } from './prompts.js'
