/**
 * Workflow Template Variables
 *
 * TemplateContext + resolveTemplate, shared by the executor and the parallel
 * child runners.
 */

export interface TemplateContext {
  workdir: string
  reason: string
  /** @deprecated Use stepOutput.content instead */
  verifierFindings: string
  /** @deprecated Use stepOutput.stdout instead */
  previousStepOutput: string
  criteriaCount: number
  pendingCount: number
  criteriaList: string
  modifiedFiles: string
  stepOutput: Record<string, string>
  /** User-supplied parameters from workflow launch (e.g. slash command args) */
  params: Record<string, string>
}

/** Canonical list of template variables — single source of truth for resolveTemplate and the API. */
export const TEMPLATE_VARIABLES: Array<{ name: string; description: string }> = [
  { name: 'workdir', description: 'Working directory of the session' },
  { name: 'reason', description: 'Human-readable reason (e.g. "2 criteria remaining")' },
  {
    name: 'stepOutput',
    description:
      'Structured output from the previous step (content, stdout, stderr, exitCode, etc.); parallel steps expose per-child keys <childId>.<key> and a summary',
  },
  {
    name: 'verifierFindings',
    description: '@deprecated Use stepOutput.content instead. Output from the last sub-agent step',
  },
  {
    name: 'previousStepOutput',
    description: '@deprecated Use stepOutput.stdout instead. Output from the last shell step',
  },
  { name: 'criteriaCount', description: 'Total number of criteria' },
  { name: 'pendingCount', description: 'Number of pending/failed criteria' },
  { name: 'criteriaList', description: 'Formatted list of all criteria with status' },
  { name: 'modifiedFiles', description: 'List of modified files' },
]

export function resolveTemplate(template: string, ctx: TemplateContext): string {
  let result = template
  // Resolve built-in variables first
  for (const { name } of TEMPLATE_VARIABLES) {
    if (name === 'stepOutput' || name === 'verifierFindings' || name === 'previousStepOutput') continue
    const value = String(ctx[name as keyof TemplateContext])
    result = result.replace(new RegExp(`\\{\\{${name}\\}\\}`, 'g'), value)
  }
  // Flat dotted keys: {{stepOutput.<key>}} — also matches parallel per-child
  // keys such as {{stepOutput.lint.stdout}}
  result = result.replace(/\{\{stepOutput\.([\w.-]+)\}\}/g, (_, key) => ctx.stepOutput[key] ?? '')
  result = result.replace(/\{\{verifierFindings\}\}/g, ctx.stepOutput['content'] ?? '')
  result = result.replace(/\{\{previousStepOutput\}\}/g, ctx.stepOutput['stdout'] ?? '')
  // Resolve user-supplied params (lower priority — can't override built-ins)
  // Use replaceAll for literal string matching (avoids regex injection from param names)
  for (const [key, value] of Object.entries(ctx.params)) {
    result = result.replaceAll(`{{${key}}}`, value)
  }
  return result
}
