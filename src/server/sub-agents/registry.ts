/**
 * Sub-Agent Registry
 * 
 * Registry for available sub-agent types with their configurations.
 */

import type { Session, PromptContext } from '../../shared/types.js'
import type { SubAgentDefinition, SubAgentRegistry } from './types.js'
import { buildVerifierPrompt } from '../chat/prompts.js'

// ============================================================================
// Context Builders
// ============================================================================

/**
 * Build verifier context from session
 */
function createVerifierContext(session: Session, args: { prompt: string }): PromptContext {
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

  return {
    systemPrompt: buildVerifierPrompt(session.workdir),
    injectedFiles: [],
    userMessage: args.prompt,
    messages: [
      { role: 'user', content: contextContent, source: 'runtime' },
      { role: 'user', content: args.prompt, source: 'runtime' },
    ],
    tools: [],
    requestOptions: { toolChoice: 'auto', disableThinking: true },
  }
}

/**
 * Build code reviewer context
 */
function createCodeReviewerContext(session: Session, args: { prompt: string }): PromptContext {
  const modifiedFiles = session.executionState?.modifiedFiles ?? []
  
  const contextContent = `## Modified Files
${modifiedFiles.length > 0 ? modifiedFiles.map(f => `- ${f}`).join('\n') : '(none)'}

## Task
${args.prompt}`

  return {
    systemPrompt: `You are a senior code reviewer.
Review the provided code changes for:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Code style and best practices
- Missing edge cases

Provide clear, actionable feedback.`,
    injectedFiles: [],
    userMessage: args.prompt,
    messages: [
      { role: 'user', content: contextContent, source: 'runtime' },
    ],
    tools: [],
    requestOptions: { toolChoice: 'auto', disableThinking: false },
  }
}

/**
 * Build test generator context
 */
function createTestGeneratorContext(session: Session, args: { prompt: string }): PromptContext {
  const contextContent = `## Task
${args.prompt}`

  return {
    systemPrompt: `You are a test generation specialist.
Generate comprehensive tests for the provided source code.

Guidelines:
- Follow the project's existing test patterns
- Cover edge cases and error conditions
- Use the appropriate test framework
- Ensure tests are deterministic and isolated
- Include descriptive test names`,
    injectedFiles: [],
    userMessage: args.prompt,
    messages: [
      { role: 'user', content: contextContent, source: 'runtime' },
    ],
    tools: [],
    requestOptions: { toolChoice: 'auto', disableThinking: false },
  }
}

/**
 * Build debugger context
 */
function createDebuggerContext(session: Session, args: { prompt: string }): PromptContext {
  const contextContent = `## Task
${args.prompt}`

  return {
    systemPrompt: `You are an expert debugger.
Analyze the provided error and code to:
1. Identify the root cause
2. Explain why the error occurs
3. Suggest specific fixes
4. Recommend prevention strategies

Be precise and provide code examples when applicable.`,
    injectedFiles: [],
    userMessage: args.prompt,
    messages: [
      { role: 'user', content: contextContent, source: 'runtime' },
    ],
    tools: [],
    requestOptions: { toolChoice: 'auto', disableThinking: false },
  }
}

// ============================================================================
// Sub-Agent Definitions
// ============================================================================

const verifierDefinition: SubAgentDefinition = {
  id: 'verifier',
  name: 'Verifier',
  description: 'Verify completed criteria against implementation',
  systemPrompt: buildVerifierPrompt('/tmp'), // Will be overridden with actual workdir
  tools: ['read_file', 'run_command', 'pass_criterion', 'fail_criterion'],
  createContext: createVerifierContext,
}

const codeReviewerDefinition: SubAgentDefinition = {
  id: 'code_reviewer',
  name: 'Code Reviewer',
  description: 'Review code changes for quality, bugs, and best practices',
  systemPrompt: `You are a senior code reviewer.
Review the provided code changes for:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Code style and best practices
- Missing edge cases

Provide clear, actionable feedback.`,
  tools: ['read_file', 'grep'],
  createContext: createCodeReviewerContext,
}

const testGeneratorDefinition: SubAgentDefinition = {
  id: 'test_generator',
  name: 'Test Generator',
  description: 'Generate tests for implemented features',
  systemPrompt: `You are a test generation specialist.
Generate comprehensive tests for the provided source code.

Guidelines:
- Follow the project's existing test patterns
- Cover edge cases and error conditions
- Use the appropriate test framework
- Ensure tests are deterministic and isolated
- Include descriptive test names`,
  tools: ['read_file', 'write_file', 'run_command'],
  createContext: createTestGeneratorContext,
}

const debuggerDefinition: SubAgentDefinition = {
  id: 'debugger',
  name: 'Debugger',
  description: 'Analyze errors and suggest fixes',
  systemPrompt: `You are an expert debugger.
Analyze the provided error and code to:
1. Identify the root cause
2. Explain why the error occurs
3. Suggest specific fixes
4. Recommend prevention strategies

Be precise and provide code examples when applicable.`,
  tools: ['read_file', 'run_command', 'grep'],
  createContext: createDebuggerContext,
}

// ============================================================================
// Registry Implementation
// ============================================================================

export function createSubAgentRegistry(): SubAgentRegistry {
  const subAgents = new Map<string, SubAgentDefinition>([
    ['verifier', verifierDefinition],
    ['code_reviewer', codeReviewerDefinition],
    ['test_generator', testGeneratorDefinition],
    ['debugger', debuggerDefinition],
  ])

  return {
    getSubAgent(id: string): SubAgentDefinition | undefined {
      return subAgents.get(id)
    },

    getAllSubAgents(): SubAgentDefinition[] {
      return Array.from(subAgents.values())
    },

    getToolRegistry(subAgentType: string): string[] {
      const definition = subAgents.get(subAgentType)
      return definition?.tools ?? []
    },
  }
}
