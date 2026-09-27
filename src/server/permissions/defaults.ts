import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadPermissionsConfig, savePermissionsConfig } from './registry.js'
import type { StoredPermissionRule } from './schema.js'
import { logger } from '../utils/logger.js'

/**
 * Rules seeded into the global permissions.json on first launch. After that
 * they are ordinary rules: the user edits or deletes them like any other.
 *
 * Only guards the hardcoded checks in path-security.ts do not already cover:
 * sensitive files (.env, keys…), `sudo`, `chmod 777`, `mkfs`, `dd`, fork bombs
 * and `rm -rf ~` already ask for confirmation there, independently of rules.
 *
 * Command patterns are anchored globs where `*` matches anything and `?` one
 * character (see rules.ts). `rm -rf /*` cannot be expressed without also
 * matching `rm -rf /tmp/x`, so only the unambiguous forms are listed.
 */
const V1_RULES: StoredPermissionRule[] = [
  {
    id: 'default-deny-rm-root',
    effect: 'DENY',
    tool: 'run_command',
    pattern: '*rm -?? /',
    description: 'Never wipe the filesystem root (rm -rf /)',
  },
  {
    id: 'default-deny-rm-root-args',
    effect: 'DENY',
    tool: 'run_command',
    pattern: '*rm -?? / *',
    description: 'Never wipe the filesystem root (rm -rf / with extra arguments)',
  },
  {
    id: 'default-deny-no-preserve-root',
    effect: 'DENY',
    tool: 'run_command',
    pattern: '*--no-preserve-root*',
    description: 'Never disable the rm root safeguard',
  },
  {
    id: 'default-ask-pipe-to-sh',
    effect: 'ASK',
    tool: 'run_command',
    pattern: '*| sh*',
    description: 'Ask before piping a download into a shell (curl … | sh)',
  },
  {
    id: 'default-ask-pipe-to-bash',
    effect: 'ASK',
    tool: 'run_command',
    pattern: '*| bash*',
    description: 'Ask before piping a download into a shell (curl … | bash)',
  },
  {
    id: 'default-ask-git-push-force',
    effect: 'ASK',
    tool: 'run_command',
    pattern: '*git push*--force*',
    description: 'Ask before force-pushing',
  },
  {
    id: 'default-ask-git-push-f',
    effect: 'ASK',
    tool: 'run_command',
    pattern: '*git push -f*',
    description: 'Ask before force-pushing',
  },
  {
    id: 'default-ask-git-push-f-args',
    effect: 'ASK',
    tool: 'run_command',
    pattern: '*git push * -f*',
    description: 'Ask before force-pushing (-f after other arguments)',
  },
]

const FILE_TOOLS = ['read_file', 'write_file', 'edit_file'] as const

const SSH_PRIVATE_KEYS = ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ecdsa_sk', 'id_ed25519', 'id_ed25519_sk']
const KEY_EXTENSIONS = ['pem', 'key', 'p12', 'pfx', 'jks', 'keystore', 'ppk']

/** A command glob for a path ending the command, or followed by more arguments. */
const endingWith = (suffix: string): string[] => [`*${suffix}`, `*${suffix} *`]

/**
 * Private keys are denied outright (the user can delete or relax the rule).
 * File tools use minimatch, so one brace/extglob pattern per location; command
 * globs have no braces, hence one rule per pattern. A command pattern is
 * matched against the command text and against each path extracted from it,
 * so `cat ~/.ssh/id_rsa` and `cat $HOME/.ssh/id_rsa` are caught either way.
 * SSH public keys (`*.pub`) and config stay readable.
 */
const DENIED_SECRETS: { key: string; description: string; files: string[]; commands: string[] }[] = [
  {
    key: 'ssh-private-key',
    description: 'SSH private keys',
    files: ['**/.ssh/id_!(*.pub)', '/etc/ssh/ssh_host_*_key'],
    commands: [
      ...SSH_PRIVATE_KEYS.flatMap((name) => endingWith(`/.ssh/${name}`)),
      ...endingWith('/etc/ssh/ssh_host_*_key'),
    ],
  },
  {
    key: 'key-file',
    description: 'private key and certificate files (.pem, .key, PKCS#12, Java keystores, PuTTY keys)',
    files: [`**/*.{${KEY_EXTENSIONS.join(',')}}`],
    commands: KEY_EXTENSIONS.flatMap((ext) => endingWith(`.${ext}`)),
  },
]

/**
 * Other secret-bearing locations, as `run_command` ASK patterns. File tools
 * need no rule there: the workdir sandbox asks for any path outside the
 * project, and the hardcoded sensitive-file guard asks inside it.
 */
const SENSITIVE_LOCATIONS: { key: string; description: string; commands: string[] }[] = [
  {
    key: 'system',
    description: 'sensitive Linux system files (shadow, sudoers, SSL private keys, sshd config)',
    commands: ['*/etc/shadow*', '*/etc/gshadow*', '*/etc/sudoers*', '*/etc/ssl/private/*', '*/etc/ssh/*'],
  },
  {
    key: 'credentials',
    description: 'credential stores (GnuPG, AWS, kubeconfig, Docker, pgpass, git credentials)',
    commands: [
      '*/.gnupg/*',
      '*/.aws/credentials*',
      '*/.kube/config*',
      '*/.docker/config.json*',
      '*/.pgpass*',
      '*/.git-credentials*',
    ],
  },
]

const V2_RULES: StoredPermissionRule[] = [
  ...DENIED_SECRETS.flatMap(({ key, description, files, commands }) => [
    ...FILE_TOOLS.flatMap((tool) =>
      files.map((pattern, index): StoredPermissionRule => ({
        id: `default-deny-${key}-${tool}${files.length > 1 ? `-${index + 1}` : ''}`,
        effect: 'DENY',
        tool,
        pattern,
        description: `Never let the agent access ${description}`,
      })),
    ),
    ...commands.map((pattern, index): StoredPermissionRule => ({
      id: `default-deny-${key}-run_command-${index + 1}`,
      effect: 'DENY',
      tool: 'run_command',
      pattern,
      description: `Never run a command that touches ${description}`,
    })),
  ]),
  ...SENSITIVE_LOCATIONS.flatMap(({ key, description, commands }) =>
    commands.map((pattern, index): StoredPermissionRule => ({
      id: `default-ask-${key}-run_command-${index + 1}`,
      effect: 'ASK',
      tool: 'run_command',
      pattern,
      description: `Ask before a command touches ${description}`,
    })),
  ),
]

/**
 * Default rules by the version that introduced them. An install that already
 * seeded version N only receives the sets above N, so rules it deleted are
 * not brought back. Append a new set to ship new defaults; never edit a
 * released one.
 */
const DEFAULT_RULE_SETS: { version: number; rules: StoredPermissionRule[] }[] = [
  { version: 1, rules: V1_RULES },
  { version: 2, rules: V2_RULES },
]

export const DEFAULT_PERMISSION_RULES: readonly StoredPermissionRule[] = DEFAULT_RULE_SETS.flatMap((set) => set.rules)

const DEFAULTS_VERSION = DEFAULT_RULE_SETS[DEFAULT_RULE_SETS.length - 1]!.version

/**
 * A rule deleted from permissions.json empties (and removes) the file, so the
 * file's absence cannot tell "never seeded" from "user deleted them all".
 * A separate marker records that seeding already happened.
 */
function getMarkerPath(configDir: string): string {
  return join(resolve(configDir), '.permissions-defaults-seeded')
}

async function readMarker(configDir: string): Promise<number> {
  try {
    const value = Number.parseInt(await readFile(getMarkerPath(configDir), 'utf-8'), 10)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

/**
 * Write the default rules into the global permissions.json once. Later calls
 * are no-ops, so rules the user deleted stay deleted. Rules the user already
 * has (same effect, tool and pattern) are not duplicated.
 */
export async function seedDefaultPermissionRules(configDir: string): Promise<void> {
  const seededVersion = await readMarker(configDir)
  if (seededVersion >= DEFAULTS_VERSION) return
  const offered = DEFAULT_RULE_SETS.filter((set) => set.version > seededVersion).flatMap((set) => set.rules)

  const existing = await loadPermissionsConfig('global', configDir, '')
  const known = new Set(existing.rules.map((rule) => `${rule.effect}\0${rule.tool}\0${rule.pattern ?? ''}`))
  const missing = offered.filter((rule) => !known.has(`${rule.effect}\0${rule.tool}\0${rule.pattern ?? ''}`))

  if (missing.length > 0) {
    await savePermissionsConfig('global', configDir, '', {
      version: 1,
      rules: [...existing.rules, ...missing.map((rule) => ({ ...rule }))],
    })
  }
  await mkdir(resolve(configDir), { recursive: true })
  await writeFile(getMarkerPath(configDir), `${DEFAULTS_VERSION}\n`, 'utf-8')
  logger.info('Seeded default permission rules', { added: missing.length })
}
