import type { Criterion } from '@openfox/shared'

export function buildValidationPrompt(
  criteria: Criterion[],
  fileContents: Map<string, string>,
  testOutput?: string,
  diagnostics?: string
): string {
  const criteriaList = criteria
    .map((c, i) => `${i + 1}. [${c.id}] ${c.description}`)
    .join('\n')
  
  let filesSection = ''
  for (const [path, content] of fileContents) {
    filesSection += `\n### ${path}\n\`\`\`\n${content.slice(0, 5000)}${content.length > 5000 ? '\n... (truncated)' : ''}\n\`\`\`\n`
  }
  
  return `You are a code reviewer performing independent verification.

Your task: Determine if the code satisfies each acceptance criterion.

## ACCEPTANCE CRITERIA
${criteriaList}

## MODIFIED FILES
${filesSection || 'No files provided.'}
${testOutput ? `\n## TEST OUTPUT\n\`\`\`\n${testOutput}\n\`\`\`` : ''}
${diagnostics ? `\n## LSP DIAGNOSTICS\n${diagnostics}` : ''}

## INSTRUCTIONS
For each criterion, carefully analyze the code and determine:
1. Does the implementation satisfy the requirement?
2. Are there any edge cases not handled?
3. Are there any bugs or issues?

Be strict. Only mark PASS if the criterion is fully satisfied.
If a criterion was not addressed at all, mark it as FAIL with reason "Not implemented".

Output ONLY valid JSON (no markdown):
{
  "results": [
    {
      "criterionId": "criterion-1",
      "status": "pass",
      "reasoning": "Detailed explanation of why this passes",
      "issues": []
    },
    {
      "criterionId": "criterion-2",
      "status": "fail",
      "reasoning": "Explanation of what's wrong",
      "issues": ["Specific issue 1", "Specific issue 2"]
    }
  ]
}`
}
