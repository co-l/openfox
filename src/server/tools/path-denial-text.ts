import type { Translation } from '../../shared/i18n/index.js'
import type { PathDenialReason } from './path-security.js'

/**
 * Single source of truth for the wording of a path/command denial.
 *
 * Three call sites render the same denial: the `PathAccessDeniedError` message
 * (English, dev-facing), the tool result handed back to the agent, and the
 * `chat.error` shown to the user. Keeping the phrasing here means a new
 * `PathDenialReason` is worded once instead of in three ternary chains.
 *
 * Two registers are needed, so each reason carries both:
 * - `subject` — a noun phrase for "User denied access to {subject}."
 * - `qualifier` — a parenthetical for "Access denied to /etc/passwd ({qualifier})."
 */
interface DenialPhrases {
  subject: Translation
  qualifier: Translation
}

const PHRASES: Record<PathDenialReason, DenialPhrases> = {
  sensitive_file: {
    subject: {
      en: 'sensitive files that may contain secrets',
      fr: 'des fichiers sensibles pouvant contenir des secrets',
    },
    qualifier: { en: 'sensitive file', fr: 'fichier sensible' },
  },
  both: {
    subject: {
      en: 'files outside the project and sensitive files',
      fr: 'des fichiers hors du projet et des fichiers sensibles',
    },
    qualifier: {
      en: 'outside the project directory and sensitive',
      fr: 'hors du dossier du projet et sensible',
    },
  },
  rule_denied: {
    subject: {
      en: 'paths/commands blocked by a permission rule',
      fr: 'des chemins/commandes bloqués par une règle de permission',
    },
    qualifier: { en: 'blocked by a permission rule', fr: 'bloqué par une règle de permission' },
  },
  rule_ask: {
    subject: {
      en: 'paths/commands requiring confirmation per a permission rule',
      fr: 'des chemins/commandes nécessitant une confirmation selon une règle de permission',
    },
    qualifier: {
      en: 'requiring confirmation per a permission rule',
      fr: 'nécessitant une confirmation selon une règle de permission',
    },
  },
  git_no_verify: {
    subject: { en: 'git commands with --no-verify', fr: 'des commandes git avec --no-verify' },
    qualifier: { en: 'git command with --no-verify', fr: 'commande git avec --no-verify' },
  },
  dangerous_command: {
    subject: { en: 'potentially dangerous commands', fr: 'des commandes potentiellement dangereuses' },
    qualifier: { en: 'potentially dangerous command', fr: 'commande potentiellement dangereuse' },
  },
  outside_workdir: {
    subject: { en: 'files outside the project directory', fr: 'des fichiers hors du dossier du projet' },
    qualifier: { en: 'outside the project directory', fr: 'hors du dossier du projet' },
  },
}

/** Noun phrase naming what was denied, for "User denied access to {subject}." */
export function denialSubject(reason: PathDenialReason): Translation {
  return PHRASES[reason].subject
}

/** Parenthetical qualifier, for "Access denied to /etc/passwd ({qualifier})." */
export function denialQualifier(reason: PathDenialReason): Translation {
  return PHRASES[reason].qualifier
}

/**
 * Tool result returned to the agent. LLM-facing, so English whatever the
 * display locale: a localized result would change the cached history.
 */
export function denialToolResultText(reason: PathDenialReason, paths: string[]): string {
  const target = paths.join(', ')
  const qualifier = PHRASES[reason].qualifier.en
  const lead = reason === 'rule_denied' ? `Blocked ${target}` : `User denied access to ${target}`
  return `${lead} (${qualifier}). If you need this file, explain why and ask the user for permission.`
}

/** `chat.error` shown to the user when a turn aborts on a denial. Interpolates `{{reason}}`. */
export function denialChatErrorText(reason: PathDenialReason): Translation {
  if (reason === 'rule_denied') {
    return { en: 'Blocked {{reason}}.', fr: 'Bloqué : {{reason}}.' }
  }
  return { en: 'User denied access to {{reason}}.', fr: 'Accès refusé par l’utilisateur : {{reason}}.' }
}

/** English-only phrasing for the `Error.message` of `PathAccessDeniedError`. */
export function denialErrorMessage(reason: PathDenialReason, paths: string[]): string {
  return `User denied access to ${PHRASES[reason].subject.en}: ${paths.join(', ')}`
}
