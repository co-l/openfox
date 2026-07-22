/**
 * Git environment variables that affect repo discovery, object storage,
 * refs, and other core behavior. Stripping all of them ensures spawned
 * git processes auto-discover the repo from their cwd rather than
 * inheriting parent-process git state (e.g. from husky hooks).
 */
const GIT_ENV_VARS = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_PREFIX',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_NAMESPACE',
  'GIT_SHALLOW_FILE',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_COUNT',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_SSL_NO_VERIFY',
  'GIT_TERMINAL_PROMPT',
  'GIT_PROTOCOL_FROM_USER',
  'GIT_ALLOW_PROTOCOL',
  'GIT_LITERAL_PATHSPECS',
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
  'GIT_FLUSH',
  'GIT_REFLOG_ACTION',
  'GIT_SEQUENCE_EDITOR',
  'GIT_EDITOR',
  'GIT_PAGER',
  'GIT_EXTERNAL_DIFF',
  'GIT_DIFF_OPTS',
  'GIT_NOTES_REF',
  'GIT_NOTES_DISPLAY_REF',
  'GIT_NOTES_REWRITE_MODE',
  'GIT_NOTES_REWRITE_REF',
  'GIT_MERGE_AUTOEDIT',
]

export function gitSpawnEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of GIT_ENV_VARS) {
    delete env[key]
  }
  // Also sweep any GIT_CONFIG_KEY_N / GIT_CONFIG_VALUE_N vars
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) {
      delete env[key]
    }
  }
  return env
}
