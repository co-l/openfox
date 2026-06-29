/* jscpd:ignore-start */
export interface MockToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface MockRule {
  match: RegExp
  tools: MockToolCall[]
  response: string
}

export const RULES: MockRule[] = [
  // ---------------------------------------------------------------------------
  // Session Metadata Tools (criteria, todos, review_findings)
  // ---------------------------------------------------------------------------
  {
    match: /ID\s*["']([a-z0-9-]+)["']:\s*["']([^"']+)["'][\s\S]*ID\s*["']([a-z0-9-]+)["']:\s*["']([^"']+)["']/i,
    tools: [
      { name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: '$1', description: '$2' } },
      { name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: '$3', description: '$4' } },
    ],
    response: 'Added both criteria.',
  },
  {
    match: /Add criterion ID\s*["']([a-z0-9-]+)["']\s*with description\s*["']([^"']+)["'][\s\S]*/i,
    tools: [{ name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: '$1', description: '$2' } }],
    response: 'Added the criterion.',
  },
  {
    match: /ID\s*["']([a-z0-9-]+)["'].*description\s*["']([^"']+)["']/i,
    tools: [{ name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: '$1', description: '$2' } }],
    response: 'Added the criterion.',
  },
  {
    match: /Add these two acceptance criteria:\s*1\.\s*([^\n]+)\s*2\.\s*([^\n]+)\s*Use criterion for each\./i,
    tools: [
      { name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: 'criterion-1', description: '$1' } },
      { name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: 'criterion-2', description: '$2' } },
    ],
    response: 'Added both criteria.',
  },
  {
    match:
      /Add these two acceptance criteria:[\s\S]*?1\.\s*([^\n]+)[\s\S]*?2\.\s*([^\n]+)[\s\S]*?Use (?:add_)?criterion for each one\./i,
    tools: [
      { name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: 'criterion-1', description: '$1' } },
      { name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: 'criterion-2', description: '$2' } },
    ],
    response: 'Added both criteria.',
  },
  {
    match: /Add these two acceptance criteria:[\s\S]*?1\.\s*([^\n]+)[\s\S]*?2\.\s*([^\n]+)/i,
    tools: [
      { name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: 'criterion-1', description: '$1' } },
      { name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: 'criterion-2', description: '$2' } },
    ],
    response: 'Added both criteria.',
  },
  {
    match: /Add criterion:\s*([\s\S]+?)\s*Use criterion\.?/i,
    tools: [
      { name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: '$auto', description: '$1' } },
    ],
    response: 'Added the criterion.',
  },
  {
    match: /propose acceptance criteria/i,
    tools: [
      {
        name: 'session_metadata',
        arguments: {
          action: 'add',
          key: 'criteria',
          id: 'criteria-1',
          description: 'A multiply function exists in math.ts that takes two numbers',
        },
      },
      {
        name: 'session_metadata',
        arguments: {
          action: 'add',
          key: 'criteria',
          id: 'criteria-2',
          description: 'The multiply function returns the correct product',
        },
      },
    ],
    response: 'Added criteria for the multiply function.',
  },
  {
    match: /ID\s*["']([a-z0-9-]+)["']\s*:\s*["']([^"']+)["']/i,
    tools: [{ name: 'session_metadata', arguments: { action: 'add', key: 'criteria', id: '$1', description: '$2' } }],
    response: 'Added the criterion.',
  },
  {
    match: /session_metadata.*(?:mark|status.*completed).*["']([a-z0-9-]+)["']/i,
    tools: [
      { name: 'session_metadata', arguments: { action: 'update', key: 'criteria', id: '$1', status: 'completed' } },
    ],
    response: 'Marked criterion as complete.',
  },
  {
    match:
      /session_metadata.*action\s*["']update["'].*key\s*["']criteria["'].*id\s*["']([a-z0-9-]+)["'].*status\s*["']completed["']/i,
    tools: [
      { name: 'session_metadata', arguments: { action: 'update', key: 'criteria', id: '$1', status: 'completed' } },
    ],
    response: 'Marked criterion as complete.',
  },
  {
    match:
      /session_metadata.*action\s*["']update["'].*key\s*["']criteria["'].*id\s*["']([a-z0-9-]+)["'].*status\s*["']passed["']/i,
    tools: [{ name: 'session_metadata', arguments: { action: 'update', key: 'criteria', id: '$1', status: 'passed' } }],
    response: 'Criterion passed.',
  },
  {
    match:
      /session_metadata.*action\s*["']update["'].*key\s*["']criteria["'].*id\s*["']([a-z0-9-]+)["'].*status\s*["']failed["']/i,
    tools: [
      {
        name: 'session_metadata',
        arguments: { action: 'update', key: 'criteria', id: '$1', status: 'failed', reason: 'Verification failed' },
      },
    ],
    response: 'Criterion failed.',
  },
  {
    match: /get_criteria|show.*criteria|list.*criteria/i,
    tools: [{ name: 'session_metadata', arguments: { action: 'get', key: 'criteria' } }],
    response: 'Here are the current criteria.',
  },
  {
    match: /session_metadata.*action\s*["']update["'].*description/i,
    tools: [
      {
        name: 'session_metadata',
        arguments: { action: 'update', key: 'criteria', id: '0', description: 'Updated description' },
      },
    ],
    response: 'Updated the criterion.',
  },
  {
    match: /session_metadata.*action\s*["']remove["']/i,
    tools: [{ name: 'session_metadata', arguments: { action: 'remove', key: 'criteria', id: '0' } }],
    response: 'Removed the criterion.',
  },
  {
    match: /add.*criterion/i,
    tools: [{ name: 'session_metadata', arguments: { action: 'add', key: 'criteria', description: 'Test criterion' } }],
    response: 'Added the criterion.',
  },
  {
    match: /session_metadata.*action\s*["']add["'].*key\s*["']criteria["'].*description\s*["']([^"']+)["']/i,
    tools: [{ name: 'session_metadata', arguments: { action: 'add', key: 'criteria', description: '$1' } }],
    response: 'Added criterion.',
  },
  {
    match:
      /session_metadata.*action\s*["']update["'].*key\s*["']criteria["'].*id\s*["']([a-z0-9-]+)["'].*status\s*["']completed["']/i,
    tools: [
      { name: 'session_metadata', arguments: { action: 'update', key: 'criteria', id: '$1', status: 'completed' } },
    ],
    response: 'Criterion completed.',
  },
  {
    match:
      /session_metadata.*action\s*["']update["'].*key\s*["']criteria["'].*id\s*["']([a-z0-9-]+)["'].*status\s*["']passed["']/i,
    tools: [{ name: 'session_metadata', arguments: { action: 'update', key: 'criteria', id: '$1', status: 'passed' } }],
    response: 'Criterion passed.',
  },
  {
    match:
      /session_metadata.*action\s*["']update["'].*key\s*["']criteria["'].*id\s*["']([a-z0-9-]+)["'].*status\s*["']failed["']/i,
    tools: [
      {
        name: 'session_metadata',
        arguments: { action: 'update', key: 'criteria', id: '$1', status: 'failed', reason: 'Verification failed' },
      },
    ],
    response: 'Criterion failed.',
  },
  {
    match: /read.*src\/math\.ts.*offset|offset.*src\/math\.ts/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/math.ts', offset: 5 } }],
    response: 'Read the file starting from line 5.',
  },
  {
    match: /read.*src\/math\.ts.*limit|limit.*src\/math\.ts|first.*lines.*src\/math\.ts/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/math.ts', limit: 3 } }],
    response: 'Read the first 3 lines of the file.',
  },
  {
    match: /read.*src.*directory|read the src directory/i,
    tools: [{ name: 'read_file', arguments: { path: 'src' } }],
    response: 'Listed directory contents.',
  },
  {
    match: /read.*src\/nonexistent|nonexistent.*does not exist/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/nonexistent.ts' } }],
    response: 'Attempted to read the file.',
  },
  {
    match: /read.*src\/index\.ts/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/index.ts' } }],
    response: 'Read the file contents.',
  },
  {
    match: /read.*src\/math\.ts/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/math.ts' } }],
    response: 'Read the file contents.',
  },
  {
    match: /read.*src\/multi\.ts/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/multi.ts' } }],
    response: 'Read the file contents.',
  },
  {
    match: /read.*package\.json/i,
    tools: [{ name: 'read_file', arguments: { path: 'package.json' } }],
    response: 'Read package.json.',
  },
  {
    match: /read.*file/i,
    tools: [{ name: 'read_file', arguments: { path: 'src/index.ts' } }],
    response: 'Read the file.',
  },
  {
    match: /glob.*\*\*\/\*\.ts|recursive.*typescript/i,
    tools: [{ name: 'glob', arguments: { pattern: '**/*.ts' } }],
    response: 'Found TypeScript files recursively.',
  },
  {
    match: /glob.*\*\.xyz|no matches/i,
    tools: [{ name: 'glob', arguments: { pattern: '*.xyz' } }],
    response: 'No files matched the pattern.',
  },
  {
    match: /glob.*\.ts|find.*typescript|find all.*\.ts/i,
    tools: [{ name: 'glob', arguments: { pattern: '**/*.ts' } }],
    response: 'Found TypeScript files.',
  },
  {
    match: /glob|find.*file/i,
    tools: [{ name: 'glob', arguments: { pattern: '**/*' } }],
    response: 'Found files.',
  },
  {
    match: /grep.*XYZNONEXISTENT|search.*XYZNONEXISTENT/i,
    tools: [{ name: 'grep', arguments: { pattern: 'XYZNONEXISTENT123', path: '.' } }],
    response: 'No matches found.',
  },
  {
    match: /grep.*regex.*function\\s/i,
    tools: [{ name: 'grep', arguments: { pattern: 'function\\s+\\w+', path: '.' } }],
    response: 'Found function declarations.',
  },
  {
    match: /grep.*export.*\*\.ts|search.*export.*typescript/i,
    tools: [{ name: 'grep', arguments: { pattern: 'export', path: '.', include: '*.ts' } }],
    response: 'Found exports in TypeScript files.',
  },
  {
    match: /grep.*function|search.*function/i,
    tools: [{ name: 'grep', arguments: { pattern: 'function', path: '.' } }],
    response: 'Found function occurrences.',
  },
  {
    match: /grep|search/i,
    tools: [{ name: 'grep', arguments: { pattern: 'export', path: '.' } }],
    response: 'Searched for pattern.',
  },
  {
    match: /write.*\/home\/test\/approved/i,
    tools: [{ name: 'write_file', arguments: { path: '/home/test/approved.txt', content: 'approved' } }],
    response: 'Wrote to the approved path.',
  },
  {
    match: /write.*\/home\/test\/denied/i,
    tools: [{ name: 'write_file', arguments: { path: '/home/test/denied.txt', content: 'denied' } }],
    response: 'Wrote to the denied path.',
  },
  {
    match: /write.*\/home\/test\/first/i,
    tools: [{ name: 'write_file', arguments: { path: '/home/test/first.txt', content: 'first' } }],
    response: 'Wrote the first file.',
  },
  {
    match: /write.*\/home\/test\/second/i,
    tools: [{ name: 'write_file', arguments: { path: '/home/test/second.txt', content: 'second' } }],
    response: 'Wrote the second file.',
  },
  {
    match: /write.*\/home\/test\/secret/i,
    tools: [{ name: 'write_file', arguments: { path: '/home/test/secret.txt', content: 'secret' } }],
    response: 'Wrote to home.',
  },
  {
    match: /without reading.*write|write.*without reading/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/index.ts', content: 'new content' } }],
    response: 'Attempted to write without reading first.',
  },
  {
    match: /create.*deep\/nested|nested.*path.*file/i,
    tools: [{ name: 'write_file', arguments: { path: 'deep/nested/path/file.ts', content: 'export const x = 1' } }],
    response: 'Created file in nested directory.',
  },
  {
    match: /create.*src\/newfile\.ts.*greeting/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/newfile.ts', content: 'export const greeting = "hello"' } }],
    response: 'Created the new file.',
  },
  {
    match: /create.*src\/utils\.ts.*greet/i,
    tools: [
      {
        name: 'write_file',
        arguments: { path: 'src/utils.ts', content: 'export function greet() { return "Hello!" }' },
      },
    ],
    response: 'Created utils.ts with greet function.',
  },
  {
    match: /create.*src\/new\.ts/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/new.ts', content: 'export const x = 1' } }],
    response: 'Created the file.',
  },
  {
    match: /write.*src\/newfile\.ts/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/newfile.ts', content: 'export const x = 1' } }],
    response: 'Wrote to file.',
  },
  {
    match: /create.*file|write.*file/i,
    tools: [{ name: 'write_file', arguments: { path: 'src/newfile.ts', content: 'export const x = 1' } }],
    response: 'Created file.',
  },
  {
    match: /without reading.*edit_file|edit_file.*without reading/i,
    tools: [{ name: 'edit_file', arguments: { path: 'src/math.ts', old_string: 'function', new_string: 'const' } }],
    response: 'Attempted to edit without reading first.',
  },
  {
    match: /edit_file.*replaceAll.*const.*let/i,
    tools: [
      { name: 'read_file', arguments: { path: 'src/multi.ts' } },
      {
        name: 'edit_file',
        arguments: { path: 'src/multi.ts', old_string: 'const', new_string: 'let', replaceAll: true },
      },
    ],
    response: 'Replaced all occurrences.',
  },
  {
    match: /edit_file.*NONEXISTENT_STRING/i,
    tools: [
      { name: 'read_file', arguments: { path: 'src/math.ts' } },
      {
        name: 'edit_file',
        arguments: { path: 'src/math.ts', old_string: 'NONEXISTENT_STRING_XYZ', new_string: 'replacement' },
      },
    ],
    response: 'Attempted to edit with non-existent string.',
  },
  {
    match: /edit_file.*add.*sum/i,
    tools: [
      { name: 'read_file', arguments: { path: 'src/math.ts' } },
      { name: 'edit_file', arguments: { path: 'src/math.ts', old_string: 'add', new_string: 'sum' } },
    ],
    response: 'Renamed function from add to sum.',
  },
  {
    match: /edit_file|edit.*file/i,
    tools: [
      { name: 'read_file', arguments: { path: 'src/math.ts' } },
      { name: 'edit_file', arguments: { path: 'src/math.ts', old_string: 'function', new_string: 'const' } },
    ],
    response: 'Edited the file.',
  },
  {
    match: /run.*echo.*first.*sleep.*second/i,
    tools: [{ name: 'run_command', arguments: { command: 'echo "first" && sleep 0.2 && echo "second"' } }],
    response: 'Executed the command sequence.',
  },
  {
    match: /run.*echo.*stdout.*stderr/i,
    tools: [{ name: 'run_command', arguments: { command: 'echo "stdout" && echo "stderr" >&2' } }],
    response: 'Executed command with stdout and stderr.',
  },
  {
    match: /run.*echo.*streaming/i,
    tools: [{ name: 'run_command', arguments: { command: 'echo "streaming test output"' } }],
    response: 'Executed streaming command.',
  },
  {
    match: /run.*echo.*Hello World/i,
    tools: [{ name: 'run_command', arguments: { command: 'echo "Hello World"' } }],
    response: 'Executed echo command.',
  },
  {
    match: /run.*cat.*package\.json/i,
    tools: [{ name: 'run_command', arguments: { command: 'cat package.json' } }],
    response: 'Displayed package.json contents.',
  },
  {
    match: /run.*cat.*nonexistent/i,
    tools: [{ name: 'run_command', arguments: { command: 'cat nonexistent-file-xyz.txt' } }],
    response: 'Attempted to read non-existent file.',
  },
  {
    match: /run.*find\s*\./i,
    tools: [{ name: 'run_command', arguments: { command: 'find .' } }],
    response: 'Listed all files.',
  },
  {
    match: /run.*ls.*workdir.*src|ls.*src.*workdir/i,
    tools: [{ name: 'run_command', arguments: { command: 'ls', cwd: 'src' } }],
    response: 'Listed src directory.',
  },
  {
    match: /run.*ls.*-la.*src/i,
    tools: [{ name: 'run_command', arguments: { command: 'ls -la src' } }],
    response: 'Listed src directory with details.',
  },
  {
    match: /run.*ls.*nonexistent/i,
    tools: [{ name: 'run_command', arguments: { command: 'ls /nonexistent/path/xyz' } }],
    response: 'Attempted to list non-existent path.',
  },
  {
    match: /run.*npm.*--version/i,
    tools: [{ name: 'run_command', arguments: { command: 'npm --version' } }],
    response: 'Checked npm version.',
  },
  {
    match: /run.*pwd.*ls/i,
    tools: [
      { name: 'run_command', arguments: { command: 'pwd' } },
      { name: 'run_command', arguments: { command: 'ls src' } },
    ],
    response: 'Executed pwd and ls.',
  },
  {
    match: /run.*ls.*src/i,
    tools: [{ name: 'run_command', arguments: { command: 'ls src' } }],
    response: 'Listed src directory.',
  },
  {
    match: /run.*ls|list.*files/i,
    tools: [{ name: 'run_command', arguments: { command: 'ls' } }],
    response: 'Listed directory contents.',
  },
  {
    match: /run.*command|execute/i,
    tools: [{ name: 'run_command', arguments: { command: 'echo "test"' } }],
    response: 'Executed the command.',
  },
  {
    match: /todo_write.*Read files.*Make changes/i,
    tools: [
      {
        name: 'session_metadata',
        arguments: { action: 'add', key: 'todos', description: 'Read files' },
      },
      {
        name: 'session_metadata',
        arguments: { action: 'add', key: 'todos', description: 'Make changes' },
      },
    ],
    response: 'Created todo list.',
  },
  {
    match: /todo_write|todo.*list/i,
    tools: [
      {
        name: 'session_metadata',
        arguments: { action: 'add', key: 'todos', description: 'Test task' },
      },
    ],
    response: 'Created todo list.',
  },
  {
    match: /think.*step.*step/i,
    tools: [],
    response:
      'Let me think step by step about this problem. First, I need to understand the requirements. Then I can propose a solution.',
  },
  {
    match: /long.*explanation|detailed.*explanation/i,
    tools: [],
    response:
      'Here is a detailed explanation of the topic. TypeScript is a statically typed superset of JavaScript that adds optional type annotations. It provides better tooling, catches errors at compile time, and makes code more maintainable.',
  },
  {
    match: /confirm.*question/i,
    tools: [{ name: 'ask_user', arguments: { question: 'Do you approve?', type: 'confirm' } }],
    response: 'I asked a confirm question.',
  },
  {
    match: /choose.*option/i,
    tools: [
      {
        name: 'ask_user',
        arguments: {
          question: 'Which option do you prefer?',
          type: 'choice',
          options: ['Option A', 'Option B', 'Option C'],
        },
      },
    ],
    response: 'I asked a choice question.',
  },
  {
    match: /ask.*user|ask.*question|clarif/i,
    tools: [{ name: 'ask_user', arguments: { question: 'What would you like me to do?' } }],
    response: 'I asked the user.',
  },
  {
    match: /confirm.*with.*user/i,
    tools: [{ name: 'ask_user', arguments: { question: 'Should I proceed with this action?' } }],
    response: 'I asked for confirmation.',
  },
  {
    match: /hello|hi there|introduce yourself/i,
    tools: [],
    response: 'Hello! I am your coding assistant. How can I help you today?',
  },
  {
    match: /magic word/i,
    tools: [],
    response: 'The magic word is "please".',
  },
  {
    match: /what.*files.*project/i,
    tools: [{ name: 'glob', arguments: { pattern: '**/*' } }],
    response: 'Let me list the project files.',
  },
  {
    match: /what.*guidelines/i,
    tools: [{ name: 'read_file', arguments: { path: 'AGENTS.md' } }],
    response: 'Let me check the guidelines.',
  },
  {
    match: /typescript|features/i,
    tools: [],
    response: 'TypeScript is a strongly typed programming language that builds on JavaScript.',
  },
  {
    match: /.*/,
    tools: [],
    response: 'I understand. Let me help you with that.',
  },
]
/* jscpd:ignore-end */
