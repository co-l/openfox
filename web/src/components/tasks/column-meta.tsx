import type { Translation } from '@shared/i18n/index.js'
import type { TaskStatus } from '@shared/types.js'

/** One source of truth for the board columns: title, header accent, chip colors. */
export interface ColumnMeta {
  status: TaskStatus
  title: Translation
  /** Header accent border class on the board column. */
  accentClass: string
  /** Text/badge color class (dots, chips) matching the column exactly. */
  dotClass: string
  /** Solid fill class for the move-menu stripe. */
  stripeClass: string
  /** Hex matching stripeClass, for inline styles (post-plan bar buttons). */
  stripeHex: string
  /** Soft badge classes (bg + text + border) for status pills outside the board. */
  badgeClass: string
}

export const COLUMN_META: ColumnMeta[] = [
  {
    status: 'backlog',
    title: { en: 'Backlog', fr: 'Backlog' },
    accentClass: 'border-t-2 border-t-zinc-500/70',
    dotClass: 'text-zinc-400',
    stripeClass: 'bg-zinc-500',
    stripeHex: '#71717a',
    badgeClass: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  },
  {
    status: 'todo',
    title: { en: 'To Do', fr: 'À faire' },
    accentClass: 'border-t-2 border-t-blue-500/60',
    dotClass: 'text-blue-400',
    stripeClass: 'bg-blue-500',
    stripeHex: '#3b82f6',
    badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  },
  {
    status: 'in_progress',
    title: { en: 'In Progress', fr: 'En cours' },
    accentClass: 'border-t-2 border-t-amber-500/60',
    dotClass: 'text-amber-400',
    stripeClass: 'bg-amber-500',
    stripeHex: '#f59e0b',
    badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  },
  {
    status: 'review',
    title: { en: 'Review', fr: 'Revue' },
    accentClass: 'border-t-2 border-t-purple-500/70',
    dotClass: 'text-purple-400',
    stripeClass: 'bg-purple-500',
    stripeHex: '#a855f7',
    badgeClass: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  },
  {
    status: 'done',
    title: { en: 'Done', fr: 'Terminées' },
    accentClass: 'border-t-2 border-t-emerald-500/60',
    dotClass: 'text-emerald-400',
    stripeClass: 'bg-emerald-500',
    stripeHex: '#10b981',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  },
]

const BY_STATUS = new Map(COLUMN_META.map((c) => [c.status, c]))

export function columnMeta(status: TaskStatus): ColumnMeta {
  return BY_STATUS.get(status) ?? COLUMN_META[1]!
}

/** Lookup for arbitrary status strings (agent-tool payloads); null when unknown. */
export function findColumnMeta(status: string): ColumnMeta | null {
  return BY_STATUS.get(status as TaskStatus) ?? null
}

/** Left-to-right board order — the move menu derives arrow direction from it. */
export const COLUMN_ORDER: TaskStatus[] = COLUMN_META.map((c) => c.status)
