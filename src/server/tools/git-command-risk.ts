/**
 * Deterministic classification of Git invocations and of the shell context
 * they run in.
 *
 * The classifier answers one narrow question: "does this command line change
 * Git state, and how?". It never decides whether a command is "safe" in
 * general — that stays with the existing path/sensitive-file/dangerous-command
 * guards in path-security.ts.
 *
 * Policy, in one paragraph:
 * - a Git invocation is classified from its real subcommand and flags, so
 *   read-only forms (`git worktree list`, `git symbolic-ref HEAD`) never
 *   prompt while writing forms (`git worktree add`, `git symbolic-ref HEAD
 *   refs/heads/other`) still do;
 * - a compound command line is split on shell operators, and each command
 *   substitution is analysed as the command it actually runs, so a protected
 *   operation cannot hide behind a harmless read;
 * - quoted text is data, not code: `grep -R 'sudo ' docs/` is a search while
 *   `echo "$(sudo whoami)"` really runs sudo;
 * - anything the classifier cannot resolve deterministically (an alias, a
 *   wrapper, an unknown flag) fails closed and is treated as a potential
 *   mutation — never as read-only.
 */

import {
  commandBasename,
  DATA_ONLY_COMMANDS,
  findCommandPayloads,
  findShellCommandOption,
  hasVariableExpansion,
  splitShellCommands,
  SHELL_COMMANDS,
  type ShellCommand,
  type ShellWord,
} from './shell-parse.js'

/** How a Git invocation affects the repository. */
export type GitRiskClass =
  'read-only' | 'routine-local-write' | 'state-changing' | 'destructive-local' | 'remote-network-affecting' | 'unknown'

export interface GitCommandClassification {
  /** The Git invocation, normalised for display in the confirmation prompt. */
  invocation: string
  /** Risk class of the invocation. */
  risk: GitRiskClass
  /** True when the invocation is a dry run (`--dry-run`, `git clean -n`). */
  dryRun: boolean
  /** True when the invocation could not be resolved deterministically. */
  unresolved: boolean
  /** Human readable reason, shown in the confirmation prompt. */
  reason: string
}

/** Commands that may prefix a Git invocation without changing its meaning. */
const GIT_WRAPPERS = new Set([
  'env',
  'sudo',
  'nohup',
  'command',
  'time',
  'nice',
  'ionice',
  'stdbuf',
  'setsid',
  'doas',
  'xargs',
  'chrt',
  'taskset',
  'builtin',
  'exec',
])

/** Git global options that take a value in the next word. */
const GIT_GLOBAL_VALUE_OPTIONS = new Set(['-C', '-c'])

/** Git global options that take a value, possibly attached with `=`. */
const GIT_GLOBAL_ASSIGNED_OPTIONS = new Set([
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--exec-path',
  '--config-env',
])

/** Git global options that take no value. */
const GIT_GLOBAL_FLAGS = new Set([
  '--bare',
  '--no-pager',
  '--paginate',
  '-p',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
  '--no-optional-locks',
  '--no-replace-objects',
  '--no-lazy-fetch',
  '--html-path',
  '--man-path',
  '--info-path',
])

/** Git subcommands that only read the repository. */
const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  'annotate',
  'blame',
  'cat-file',
  'check-attr',
  'check-ignore',
  'check-ref-format',
  'cherry',
  'count-objects',
  'describe',
  'diff',
  'diff-files',
  'diff-index',
  'diff-tree',
  'for-each-ref',
  'fsck',
  'grep',
  'help',
  'log',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'merge-base',
  'name-rev',
  'reflog',
  'rev-list',
  'rev-parse',
  'shortlog',
  'show',
  'show-branch',
  'show-ref',
  'status',
  'var',
  'verify-commit',
  'verify-tag',
  'version',
  'whatchanged',
])

/** Git subcommands that write to the working tree or the index, without changing history. */
const GIT_ROUTINE_LOCAL_SUBCOMMANDS = new Set(['add', 'stage', 'commit', 'rm', 'mv', 'config'])

/**
 * Read-only forms of the subcommands that otherwise change state.
 *
 * `git stash list`, `git submodule status`, `git notes list`,
 * `git replace -l`, `git sparse-checkout list`, `git bisect log` and
 * `git update-index --refresh` only report: they must not be reported as
 * mutations.
 */
const GIT_READ_ONLY_SUBCOMMAND_FORMS: Record<string, Set<string>> = {
  stash: new Set(['list', 'show']),
  submodule: new Set(['status']),
  notes: new Set(['list', 'show']),
  'sparse-checkout': new Set(['list']),
  bisect: new Set(['log', 'view', 'replay']),
}

/** Git subcommands that change repository state (branches, refs, history). */
const GIT_STATE_CHANGING_SUBCOMMANDS = new Set([
  'am',
  'apply',
  'bisect',
  'checkout',
  'cherry-pick',
  'filter-branch',
  'gc',
  'init',
  'merge',
  'notes',
  'prune',
  'rebase',
  'repack',
  'replace',
  'reset',
  'restore',
  'revert',
  'sparse-checkout',
  'stash',
  'submodule',
  'switch',
  'update-index',
  'update-ref',
])

/** Git subcommands that talk to a remote. */
const GIT_REMOTE_SUBCOMMANDS = new Set(['clone', 'fetch', 'pull', 'push'])

/**
 * Git subcommands the classifier knows.
 *
 * A word `git` only counts as a Git invocation when one of these follows it:
 * `sudo apt install git` and `grep git README.md` merely mention the word.
 */
const GIT_KNOWN_SUBCOMMANDS = new Set([
  ...GIT_READ_ONLY_SUBCOMMANDS,
  ...GIT_ROUTINE_LOCAL_SUBCOMMANDS,
  ...GIT_STATE_CHANGING_SUBCOMMANDS,
  ...GIT_REMOTE_SUBCOMMANDS,
  'branch',
  'clean',
  'notes',
  'remote',
  'replace',
  'sparse-checkout',
  'stash',
  'submodule',
  'symbolic-ref',
  'tag',
  'update-index',
  'worktree',
])

/** `git branch` flags that delete, rename, copy or move a branch. */
const GIT_BRANCH_MUTATING_FLAGS = new Set([
  '-d',
  '-D',
  '-m',
  '-M',
  '-c',
  '-C',
  '-f',
  '--delete',
  '--move',
  '--copy',
  '--force',
])

/** `git branch` flags that only list branches. */
const GIT_BRANCH_READ_ONLY_FLAGS = new Set(['-l', '--list', '-a', '--all', '-r', '--remotes', '--show-current'])

/** `git tag` flags that only list tags. */
const GIT_TAG_READ_ONLY_FLAGS = new Set(['-l', '--list', '-n', '--contains', '--points-at', '--merged'])

/** `git remote` subcommands that only read the remote configuration. */
const GIT_REMOTE_READ_ONLY_SUBCOMMANDS = new Set(['show', 'get-url'])

/** `git remote` subcommands that change the remote configuration or its refs. */
const GIT_REMOTE_MUTATING_SUBCOMMANDS = new Set([
  'add',
  'remove',
  'rm',
  'rename',
  'set-url',
  'set-head',
  'prune',
  'update',
])

/** Flags that make a command a dry run. */
const DRY_RUN_FLAGS = new Set(['--dry-run'])

/** True when the word looks like a `NAME=value` environment assignment. */
function isAssignment(word: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
}

/** True when the word is a flag (starts with a dash and is not a lone dash). */
function isFlag(word: string): boolean {
  return word.startsWith('-') && word !== '-' && word !== '--'
}

/** The flag name of a word: "--foo=bar" -> "--foo", "-fd" -> "-fd". */
function flagName(word: string): string {
  const eq = word.indexOf('=')
  return eq > 0 ? word.slice(0, eq) : word
}

/**
 * True when a wrapper runs Git, i.e. the Git word is in command position.
 *
 * A wrapper's own options come first, then the command it runs:
 * `sudo -u root git reset --hard` runs Git, while `sudo apt install git`
 * only mentions the word as an argument and runs no Git at all.
 *
 * @param words - Words of the command
 * @param index - Index of the wrapper word
 */
function runsGitInCommandPosition(words: ShellWord[], index: number): boolean {
  return words.slice(index + 1).some((_, position) => isGitInvocation(words, index + 1 + position))
}

/**
 * True when the word at `index` is a Git invocation.
 *
 * A Git invocation is the Git binary followed by a Git subcommand. Requiring
 * the subcommand is what separates a real invocation (`git reset --hard`)
 * from a word that merely looks like one (`sudo apt install git`,
 * `grep git README.md`, `sudo ls /opt/git`).
 *
 * The binary may be named by an absolute path (`/usr/bin/git`,
 * `C:\Program Files\Git\bin\git.exe`): commandBasename resolves it.
 *
 * @param words - Words of the command
 * @param index - Index of the candidate word
 */
function isGitInvocation(words: ShellWord[], index: number): boolean {
  const value = words[index]?.value
  if (value === undefined) return false
  if (commandBasename(value) !== 'git') return false
  const subIndex = findGitSubcommandIndex(words, index)
  if (subIndex === -1) return false
  return GIT_KNOWN_SUBCOMMANDS.has(words[subIndex]!.value)
}
/**
 * Index of the Git subcommand in a word list, skipping global options.
 *
 * @returns The index of the subcommand word, or -1 when there is none.
 */
function findGitSubcommandIndex(words: ShellWord[], start: number): number {
  let i = start + 1
  while (i < words.length) {
    const value = words[i]!.value
    if (!isFlag(value)) return i
    const name = flagName(value)
    if (GIT_GLOBAL_VALUE_OPTIONS.has(name)) {
      i += 2
      continue
    }
    if (GIT_GLOBAL_ASSIGNED_OPTIONS.has(name)) {
      i += value.includes('=') ? 1 : 2
      continue
    }
    if (GIT_GLOBAL_FLAGS.has(name)) {
      i += 1
      continue
    }
    // Unknown global option: the command line cannot be resolved.
    return -1
  }
  return -1
}

/** Positional (non-flag) words after a given index. */
function positionalWords(words: ShellWord[], start: number): string[] {
  const result: string[] = []
  for (let i = start; i < words.length; i++) {
    const value = words[i]!.value
    if (!isFlag(value)) result.push(value)
  }
  return result
}

/**
 * Flag names present in the words after a given index.
 *
 * Short flag clusters are expanded the way Git reads them: `-fd` is `-f`
 * followed by `-d`, not a flag named "fd". A cluster containing an unknown
 * letter is kept as a whole so an unrecognised form fails closed.
 */
function flagNames(words: ShellWord[], start: number): string[] {
  const result: string[] = []
  for (let i = start; i < words.length; i++) {
    const value = words[i]!.value
    if (!isFlag(value)) continue
    if (value.startsWith('--')) {
      result.push(flagName(value))
      continue
    }
    const letters = value.slice(1)
    for (const letter of letters) {
      result.push(`-${letter}`)
    }
  }
  return result
}

/** True when the words contain a dry-run flag. */
function hasDryRunFlag(words: ShellWord[], start: number): boolean {
  return words.slice(start).some((word) => DRY_RUN_FLAGS.has(flagName(word.value)) || word.value === '-n')
}

/**
 * Classify a `git worktree` invocation.
 */
function classifyWorktree(args: ShellWord[]): GitCommandClassification | null {
  const sub = args[0]?.value
  if (sub === 'list') {
    return {
      invocation: 'git worktree list',
      risk: 'read-only',
      dryRun: false,
      unresolved: false,
      reason: 'lists the registered worktrees without changing any',
    }
  }
  return {
    invocation: `git worktree ${sub ?? ''}`.trim(),
    risk: 'state-changing',
    dryRun: false,
    unresolved: false,
    reason: 'creates, moves or removes worktree metadata',
  }
}

/**
 * Classify a `git symbolic-ref` invocation: reading a ref is harmless,
 * writing or deleting one changes the repository.
 *
 * @param args - Words after the `symbolic-ref` subcommand.
 */
function classifySymbolicRef(args: ShellWord[]): GitCommandClassification {
  const flags = flagNames(args, 0)
  const positionals = positionalWords(args, 0)
  if (flags.includes('--delete') || flags.includes('-d')) {
    return {
      invocation: 'git symbolic-ref --delete',
      risk: 'destructive-local',
      dryRun: false,
      unresolved: false,
      reason: 'deletes a symbolic ref',
    }
  }
  if (positionals.length >= 2) {
    return {
      invocation: 'git symbolic-ref',
      risk: 'state-changing',
      dryRun: false,
      unresolved: false,
      reason: 'points a ref at another ref',
    }
  }
  return {
    invocation: 'git symbolic-ref',
    risk: 'read-only',
    dryRun: false,
    unresolved: false,
    reason: 'reads the current symbolic ref',
  }
}

/**
 * Classify a `git clean` invocation: only the force form destroys files.
 *
 * @param args - Words after the `clean` subcommand.
 */
function classifyClean(args: ShellWord[]): GitCommandClassification {
  const flags = flagNames(args, 0)
  const dryRun = flags.includes('--dry-run') || flags.includes('-n')
  if (dryRun) {
    return {
      invocation: 'git clean --dry-run',
      risk: 'read-only',
      dryRun: true,
      unresolved: false,
      reason: 'dry run, nothing is deleted',
    }
  }
  if (flags.includes('--force') || flags.includes('-f')) {
    return {
      invocation: 'git clean',
      risk: 'destructive-local',
      dryRun: false,
      unresolved: false,
      reason: 'deletes untracked files and directories',
    }
  }
  return {
    invocation: 'git clean',
    risk: 'read-only',
    dryRun: false,
    unresolved: false,
    reason: 'without --force, git clean deletes nothing',
  }
}

/**
 * Classify a `git branch` invocation: listing branches is harmless, creating,
 * deleting, renaming or moving one changes the repository.
 *
 * @param args - Words after the `branch` subcommand.
 */
function classifyBranch(args: ShellWord[]): GitCommandClassification {
  const flags = flagNames(args, 0)
  if (flags.some((flag) => GIT_BRANCH_MUTATING_FLAGS.has(flag))) {
    return {
      invocation: 'git branch',
      risk: 'state-changing',
      dryRun: false,
      unresolved: false,
      reason: 'deletes, renames, copies or moves a branch',
    }
  }
  if (flags.some((flag) => GIT_BRANCH_READ_ONLY_FLAGS.has(flag))) {
    return {
      invocation: 'git branch',
      risk: 'read-only',
      dryRun: false,
      unresolved: false,
      reason: 'lists branches',
    }
  }
  if (positionalWords(args, 0).length > 0) {
    return {
      invocation: 'git branch',
      risk: 'state-changing',
      dryRun: false,
      unresolved: false,
      reason: 'creates a branch',
    }
  }
  return {
    invocation: 'git branch',
    risk: 'read-only',
    dryRun: false,
    unresolved: false,
    reason: 'lists branches',
  }
}

/**
 * Classify a `git tag` invocation.
 *
 * @param args - Words after the `tag` subcommand.
 */
function classifyTag(args: ShellWord[]): GitCommandClassification {
  const flags = flagNames(args, 0)
  if (flags.includes('--delete') || flags.includes('-d')) {
    return {
      invocation: 'git tag --delete',
      risk: 'destructive-local',
      dryRun: false,
      unresolved: false,
      reason: 'deletes a tag',
    }
  }
  if (flags.some((flag) => GIT_TAG_READ_ONLY_FLAGS.has(flag))) {
    return {
      invocation: 'git tag',
      risk: 'read-only',
      dryRun: false,
      unresolved: false,
      reason: 'lists tags',
    }
  }
  if (positionalWords(args, 0).length > 0) {
    return {
      invocation: 'git tag',
      risk: 'state-changing',
      dryRun: false,
      unresolved: false,
      reason: 'creates a tag',
    }
  }
  return {
    invocation: 'git tag',
    risk: 'read-only',
    dryRun: false,
    unresolved: false,
    reason: 'lists tags',
  }
}

/**
 * Classify a `git remote` invocation.
 */
function classifyRemote(args: ShellWord[]): GitCommandClassification {
  const sub = args[0]?.value
  if (sub && GIT_REMOTE_MUTATING_SUBCOMMANDS.has(sub)) {
    return {
      invocation: `git remote ${sub}`,
      risk: 'state-changing',
      dryRun: false,
      unresolved: false,
      reason: 'changes the remote configuration or its refs',
    }
  }
  if (sub && GIT_REMOTE_READ_ONLY_SUBCOMMANDS.has(sub)) {
    return {
      invocation: `git remote ${sub}`,
      risk: 'read-only',
      dryRun: false,
      unresolved: false,
      reason: 'reads the remote configuration',
    }
  }
  return {
    invocation: 'git remote',
    risk: 'read-only',
    dryRun: false,
    unresolved: false,
    reason: 'lists the configured remotes',
  }
}

/**
 * Classify a Git invocation from its subcommand and arguments.
 */
function classifySubcommand(subcommand: string, args: ShellWord[]): GitCommandClassification {
  const invocation = `git ${subcommand}`
  const base = {
    invocation,
    dryRun: false,
    unresolved: false,
  }

  if (GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return { ...base, risk: 'read-only', reason: 'only reads the repository' }
  }
  if (GIT_ROUTINE_LOCAL_SUBCOMMANDS.has(subcommand)) {
    return { ...base, risk: 'routine-local-write', reason: 'writes to the working tree or the index only' }
  }
  if (GIT_REMOTE_SUBCOMMANDS.has(subcommand)) {
    const dryRun = hasDryRunFlag(args, 0)
    const reason = dryRun
      ? subcommand === 'push'
        ? 'dry run: no remote ref is updated, but the pre-push hook still runs'
        : 'dry run: the remote is contacted, but no ref or FETCH_HEAD is written'
      : 'contacts a remote and updates local or remote refs'
    return { ...base, risk: 'remote-network-affecting', dryRun, reason }
  }
  if (subcommand === 'worktree') {
    return classifyWorktree(args) ?? { ...base, risk: 'state-changing', reason: 'changes worktree metadata' }
  }
  if (subcommand === 'symbolic-ref') {
    return classifySymbolicRef(args)
  }
  if (subcommand === 'clean') {
    return classifyClean(args)
  }
  if (subcommand === 'branch') {
    return classifyBranch(args)
  }
  if (subcommand === 'tag') {
    return classifyTag(args)
  }
  if (subcommand === 'remote') {
    return classifyRemote(args)
  }
  // Some subcommands have read-only forms: `git stash list`,
  // `git submodule status`, `git notes list`, `git sparse-checkout list`,
  // `git bisect log`.
  const readOnlyForms = GIT_READ_ONLY_SUBCOMMAND_FORMS[subcommand]
  if (readOnlyForms) {
    const form = positionalWords(args, 0)[0]
    if (form !== undefined && readOnlyForms.has(form)) {
      return { ...base, risk: 'read-only', reason: `only reports \`git ${subcommand} ${form}\`` }
    }
  }
  if (subcommand === 'replace') {
    // `git replace -l` lists the replaced objects.
    const flags = flagNames(args, 0)
    if (flags.includes('-l') || flags.includes('--list')) {
      return { ...base, risk: 'read-only', reason: 'only lists the replaced objects' }
    }
  }
  if (subcommand === 'update-index') {
    // `git update-index --refresh` only refreshes the index stat information.
    const flags = flagNames(args, 0)
    if (flags.includes('--refresh')) {
      return { ...base, risk: 'read-only', reason: 'only refreshes the index stat information' }
    }
  }
  if (subcommand === 'reset') {
    const flags = flagNames(args, 0)
    if (flags.includes('--hard')) {
      return { ...base, risk: 'destructive-local', reason: 'discards uncommitted changes' }
    }
    return { ...base, risk: 'state-changing', reason: 'moves the current branch' }
  }
  if (GIT_STATE_CHANGING_SUBCOMMANDS.has(subcommand)) {
    return { ...base, risk: 'state-changing', reason: 'changes the repository state' }
  }
  return {
    ...base,
    risk: 'unknown',
    unresolved: true,
    reason: 'unknown Git subcommand, possibly an alias: treated as a potential mutation',
  }
}

/**
 * Classify the Git invocation of a single shell command, if any.
 */
function classifyCommand(segment: ShellCommand): GitCommandClassification | null {
  const words = segment.words
  let index = 0
  while (index < words.length && isAssignment(words[index]!.value)) index += 1

  if (index >= words.length) return null

  const command = commandBasename(words[index]!.value)

  if (GIT_WRAPPERS.has(command)) {
    // A wrapper can hide anything behind the wrapped command: `env git …`.
    // The wrapper's own options and their values sit between the wrapper and
    // the wrapped command (`sudo -u root git …`), and which options take a
    // value differs per wrapper. Instead of guessing, look for a Git word in
    // *command position* — the word the wrapper actually runs. A Git word that
    // is only an argument (`sudo apt install git`) is not a Git invocation.
    if (runsGitInCommandPosition(words, index)) {
      return {
        invocation: segment.raw.trim(),
        risk: 'unknown',
        dryRun: false,
        unresolved: true,
        reason: `wrapped in \`${command}\`: the Git command behind it cannot be resolved`,
      }
    }
    // The wrapper runs a command string: `sudo sh -c "git clean -fd"`.
    // Classify what that command really runs.
    const payload = findCommandPayloads(segment)[0]
    if (payload !== undefined) {
      // A dynamic payload (`sh -c "$CMD"`) runs whatever the variable holds:
      // the command is only known at run time, so it fails closed.
      if (payload.dynamic) {
        return {
          invocation: segment.raw.trim(),
          risk: 'unknown',
          dryRun: false,
          unresolved: true,
          reason: `wrapped in \`${command}\`: the command it runs is only known at run time`,
        }
      }
      const nested = classifyGitCommand(payload.text)
      if (nested) return { ...nested, invocation: segment.raw.trim() }
      // No Git in the payload: the wrapper runs something else entirely.
      if (!mentionsGitCommand(payload.text)) return null
      return {
        invocation: segment.raw.trim(),
        risk: 'unknown',
        dryRun: false,
        unresolved: true,
        reason: `wrapped in \`${command}\`: the Git command behind it cannot be resolved`,
      }
    }
    // The wrapper runs something that is provably not Git: not our business.
    return null
  }

  if (command === 'git') {
    const subIndex = findGitSubcommandIndex(words, index)
    if (subIndex === -1) {
      if (
        words.slice(index + 1).some((word) => flagName(word.value) === '--version' || flagName(word.value) === '--help')
      ) {
        return {
          invocation: 'git --version',
          risk: 'read-only',
          dryRun: false,
          unresolved: false,
          reason: 'prints the Git version',
        }
      }
      return {
        invocation: segment.raw.trim(),
        risk: 'unknown',
        dryRun: false,
        unresolved: true,
        reason: 'the Git command cannot be resolved deterministically',
      }
    }
    const subcommand = words[subIndex]!.value
    const args = words.slice(subIndex + 1)
    const classification = classifySubcommand(subcommand, args)
    // Drop the global options from the displayed invocation: they carry no
    // meaning for the user and would hide the actual subcommand.
    const rest = args.map((word) => word.raw).join(' ')
    return {
      ...classification,
      invocation: rest.length > 0 ? `git ${subcommand} ${rest}` : `git ${subcommand}`,
    }
  }

  if (command === 'eval') {
    // `eval "git clean -fd"` runs the string it is given. It is handled
    // before the generic payload branch, which would otherwise treat the
    // string as an opaque argument.
    const script = words
      .slice(index + 1)
      .map((word) => word.value)
      .join(' ')
    if (script.length === 0) return null
    // A dynamic script runs whatever the variable holds: fail closed.
    if (hasVariableExpansion(script)) {
      return {
        invocation: segment.raw.trim(),
        risk: 'unknown',
        dryRun: false,
        unresolved: true,
        reason: 'the command eval runs is only known at run time',
      }
    }
    const nested = classifyGitCommand(script)
    if (!nested) return null
    return { ...nested, invocation: `eval "${script}"` }
  }

  if (SHELL_COMMANDS.has(command)) {
    // `sh -c "git clean -fd"` really runs the quoted string. The option may
    // carry other flags (`-lc`) or follow them (`-x -c`), so look for `-c`
    // among the shell's option words instead of requiring it to be the first.
    const optionIndex = findShellCommandOption(words, index)
    if (optionIndex !== -1) {
      const script = words[optionIndex + 1]?.value
      if (script === undefined) return null
      // A dynamic script (`sh -c "$CMD"`) runs whatever the variable holds:
      // the command is only known at run time, so it fails closed.
      if (hasVariableExpansion(script)) {
        return {
          invocation: segment.raw.trim(),
          risk: 'unknown',
          dryRun: false,
          unresolved: true,
          reason: 'the command the shell runs is only known at run time',
        }
      }
      // The whole payload runs: a mutation may follow a read-only command.
      const nested = classifyGitCommand(script)
      if (!nested) return null
      return { ...nested, invocation: `${command} "${script}"` }
    }
  }

  // A command string anywhere in the segment: `su -c "git clean -fd"`,
  // `timeout 5 sh -c "git clean -fd"`, `FOO=1 sh -c "…"`.
  const payloads = findCommandPayloads(segment)
  if (payloads.length > 0) {
    // A dynamic payload (`eval "$CMD"`, `sh -c "$CMD"`) runs whatever the
    // variable holds: the command is only known at run time, so it fails
    // closed.
    for (const payload of payloads) {
      if (!payload.dynamic) continue
      return {
        invocation: segment.raw.trim(),
        risk: 'unknown',
        dryRun: false,
        unresolved: true,
        reason: 'the command it runs is only known at run time',
      }
    }
    for (const payload of payloads) {
      const nested = classifyGitCommand(payload.text)
      if (nested) return { ...nested, invocation: segment.raw.trim() }
    }
    // A source payload holds the Git command as program text: in
    // `python -c "os.system('git reset --hard')"` the inner quoted text is
    // a string the program executes, not a shell word, so the payload is
    // scanned as raw text.
    for (const payload of payloads) {
      if (!payload.source) continue
      if (!mentionsGitCommandInText(payload.text)) continue
      return {
        invocation: segment.raw.trim(),
        risk: 'unknown',
        dryRun: false,
        unresolved: true,
        reason: 'the Git command inside the program source cannot be resolved',
      }
    }
    // No Git in any payload: the command string runs something else.
    if (!payloads.some((payload) => mentionsGitCommand(payload.text))) return null
    return {
      invocation: segment.raw.trim(),
      risk: 'unknown',
      dryRun: false,
      unresolved: true,
      reason: 'the Git command behind the command string cannot be resolved',
    }
  }

  // The command is not a Git command and not a known executor: it may still
  // run Git behind the scenes (`docker exec c git reset --hard`,
  // `kubectl exec p -- git reset --hard`, `make git reset --hard`). When the
  // segment mentions Git but the invocation cannot be resolved, fail closed.
  // A command that only prints or searches text (`echo git status`,
  // `grep git log README.md`) runs no Git at all and is never reported.
  if (!DATA_ONLY_COMMANDS.has(command) && mentionsGitCommandInCommandPosition(segment)) {
    return {
      invocation: segment.raw.trim(),
      risk: 'unknown',
      dryRun: false,
      unresolved: true,
      reason: `run through \`${command}\`: the Git command behind it cannot be resolved`,
    }
  }

  return null
}

/**
 * Classify the Git invocations of a whole command line.
 *
 * @returns The first invocation that needs a confirmation, or null when every
 * Git invocation of the command line is read-only or a routine local write.
 */
export function classifyGitCommand(command: string): GitCommandClassification | null {
  for (const segment of splitShellCommands(command)) {
    const classification = classifyCommand(segment)
    if (!classification) continue
    if (classification.risk === 'read-only' || classification.risk === 'routine-local-write') continue
    return classification
  }
  return null
}

/**
 * True when a command line mentions a Git command word at all.
 *
 * It separates "there is no Git here" from "there is Git but its command
 * cannot be resolved": only the latter is reported as an unresolved
 * mutation, so a non-Git command behind a wrapper is never blocked.
 *
 * @param command - The command line to inspect
 */
export function mentionsGitCommand(command: string): boolean {
  for (const segment of splitShellCommands(command)) {
    for (const word of segment.words) {
      if (commandBasename(word.value) === 'git') return true
    }
  }
  return false
}

/**
 * True when a raw text mentions a Git command word.
 *
 * Used for interpreter source payloads, where the Git command is embedded in
 * program text rather than in shell words: `os.system('git reset --hard')`.
 *
 * @param text - The raw text to inspect
 */
export function mentionsGitCommandInText(text: string): boolean {
  return /(^|[^A-Za-z0-9_.-])git(\s|$|[^A-Za-z0-9_-])/.test(text)
}

/**
 * True when a segment runs Git in command position, whatever the command is.
 *
 * `docker exec c git reset --hard` and `kubectl exec p -- git reset --hard`
 * run Git, while `sudo apt install git` only mentions the word as an
 * argument. The Git word is looked for after the command's own options and
 * after the operands that precede it (`docker exec <container>`).
 *
 * @param segment - One command of a command line
 */
function mentionsGitCommandInCommandPosition(segment: ShellCommand): boolean {
  const words = segment.words
  for (let i = 1; i < words.length; i++) {
    if (isGitInvocation(words, i)) return true
  }
  return false
}
