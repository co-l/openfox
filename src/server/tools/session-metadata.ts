import type { MetadataEntry, ToolResult } from '../../shared/types.js'
import { createTool, validateActionWithPermission, requireSession } from './tool-helpers.js'
import { serverT } from '../i18n.js'

const SCHEMAS: Record<string, { fields: Record<string, string>; description: string }> = {
  criteria: {
    description: 'Acceptance criteria that drive workflow transitions',
    fields: {
      id: 'string (auto-generated; numeric ids accepted and normalized)',
      description: 'string — what needs to be done and how to verify it',
      status: 'pending | completed | passed | failed',
    },
  },
  todos: {
    description: 'Task tracking items for the builder',
    fields: {
      id: 'string (auto-generated)',
      description: 'string — task description',
      status: 'pending | in_progress | completed',
    },
  },
  review_findings: {
    description: 'Code review findings from the code_reviewer sub-agent',
    fields: {
      id: 'string (auto-generated)',
      description: 'string — finding description',
      status: 'open | resolved | dismissed',
      severity: 'minor | major | critical (optional)',
    },
  },
}

interface SessionMetadataArgs {
  action: 'get' | 'list' | 'add' | 'update' | 'remove' | 'schema'
  key?: string
  id?: string
  description?: string
  status?: string
}

function normalizeId(id: unknown): string | undefined {
  if (typeof id !== 'string' && typeof id !== 'number') return undefined
  if (id === '') return undefined
  return String(id)
}

function requireKeyAndId(
  args: SessionMetadataArgs,
  helpers: { error: (msg: string) => ToolResult },
  entries: Record<string, MetadataEntry[]>,
): MetadataEntry[] | ToolResult {
  if (!args.key) return helpers.error(serverT({ en: 'Missing required field: key', fr: 'Champ requis manquant : key' }))
  if (normalizeId(args.id) === undefined)
    return helpers.error(serverT({ en: 'Missing required field: id', fr: 'Champ requis manquant : id' }))
  const current = entries[args.key]
  if (!current)
    return helpers.error(
      serverT({ en: 'Key "{{key}}" not found.', fr: 'Clé « {{key}} » introuvable.' }, { key: args.key ?? '' }),
    )
  return current
}

export const sessionMetadataTool = createTool<SessionMetadataArgs>(
  'session_metadata',
  {
    type: 'function',
    function: {
      name: 'session_metadata',
      description:
        'Manage structured session data. Each key holds an array of items with id (auto), description, and status. Known keys: criteria, todos, review_findings. Use action=schema to see the expected shape for a specific key.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'list', 'add', 'update', 'remove', 'schema'],
            description: 'The action to perform',
          },
          key: {
            type: 'string',
            description:
              'Metadata key (required for: get, add, update, remove, schema). Known keys: criteria, todos, review_findings.',
          },
          id: {
            type: 'string',
            description:
              'Item ID (required for: update, remove). Accepts numeric ids too — they are normalized to strings.',
          },
          description: {
            type: 'string',
            description: 'Item description (required for: add)',
          },
          status: {
            type: 'string',
            description: 'Item status (for: add, update). Defaults to "pending" on add.',
          },
        },
        required: ['action'],
      },
    },
  },
  async (args, context, helpers) => {
    const actionError = validateActionWithPermission(
      args.action,
      ['get', 'list', 'add', 'update', 'remove', 'schema'],
      'session_metadata',
      context.permittedActions,
    )
    if (actionError) return actionError

    const session = requireSession(context.sessionManager, context.sessionId)
    const entries = session.metadataEntries ?? {}

    if (args.action === 'list') {
      const keys = Object.keys(entries)
      if (keys.length === 0)
        return helpers.success(serverT({ en: 'No metadata keys defined.', fr: 'Aucune clé de métadonnées définie.' }))
      return helpers.success(
        `Metadata keys:\n${keys.map((k) => `- ${k} (${entries[k]?.length ?? 0} items)`).join('\n')}`,
      )
    }

    if (args.action === 'schema') {
      if (!args.key)
        return helpers.error(serverT({ en: 'Missing required field: key', fr: 'Champ requis manquant : key' }))
      const schema = SCHEMAS[args.key]
      if (!schema)
        return helpers.success(
          serverT(
            {
              en: 'No schema defined for key "{{key}}". Items have id, description, and status fields.',
              fr: 'Aucun schéma défini pour la clé « {{key}} ». Les éléments ont des champs id, description et status.',
            },
            { key: args.key ?? '' },
          ),
        )
      return helpers.success(
        `Key: ${args.key}\nDescription: ${schema.description}\nFields:\n${Object.entries(schema.fields)
          .map(([f, t]) => `  ${f}: ${t}`)
          .join('\n')}`,
      )
    }

    if (args.action === 'get') {
      if (!args.key)
        return helpers.error(serverT({ en: 'Missing required field: key', fr: 'Champ requis manquant : key' }))
      const keyEntries = entries[args.key]
      if (!keyEntries || keyEntries.length === 0)
        return helpers.success(
          serverT(
            { en: 'No entries for key "{{key}}".', fr: 'Aucune entrée pour la clé « {{key}} ».' },
            { key: args.key ?? '' },
          ),
        )
      return helpers.success(JSON.stringify(keyEntries, null, 2))
    }

    if (args.action === 'add') {
      if (!args.key)
        return helpers.error(serverT({ en: 'Missing required field: key', fr: 'Champ requis manquant : key' }))
      if (!args.description)
        return helpers.error(
          serverT({ en: 'Missing required field: description', fr: 'Champ requis manquant : description' }),
        )

      const current = entries[args.key] ?? []
      const newEntry: MetadataEntry = {
        id: normalizeId(args.id) ?? (current.length + 1).toString(),
        description: args.description,
        status: args.status || 'pending',
      }
      const updated = [...current, newEntry]
      context.sessionManager.setMetadataEntries(context.sessionId, args.key, updated)
      return helpers.success(
        serverT(
          {
            en: 'Added item "{{id}}" to "{{key}}". Total: {{count}} items.',
            fr: 'Élément « {{id}} » ajouté à « {{key}} ». Total : {{count}} éléments.',
          },
          { id: newEntry.id, key: args.key ?? '', count: updated.length },
        ),
      )
    }

    if (args.action === 'update') {
      const current = requireKeyAndId(args, helpers, entries)
      if (!Array.isArray(current)) return current
      const id = normalizeId(args.id)!
      const idx = current.findIndex((e) => e.id === id)
      if (idx === -1)
        return helpers.error(
          serverT(
            { en: 'Item "{{id}}" not found in "{{key}}".', fr: 'Élément « {{id}} » introuvable dans « {{key}} ».' },
            { id, key: args.key ?? '' },
          ),
        )

      const updated = current.map((e, i) =>
        i === idx
          ? {
              ...e,
              ...(args.description !== undefined ? { description: args.description } : {}),
              ...(args.status !== undefined ? { status: args.status } : {}),
            }
          : e,
      )
      context.sessionManager.setMetadataEntries(context.sessionId, args.key!, updated)
      return helpers.success(
        serverT(
          { en: 'Updated item "{{id}}" in "{{key}}".', fr: 'Élément « {{id}} » mis à jour dans « {{key}} ».' },
          { id, key: args.key ?? '' },
        ),
      )
    }

    if (args.action === 'remove') {
      const current = requireKeyAndId(args, helpers, entries)
      if (!Array.isArray(current)) return current
      const id = normalizeId(args.id)!

      const updated = current.filter((e) => e.id !== id)
      if (updated.length === current.length)
        return helpers.error(
          serverT(
            { en: 'Item "{{id}}" not found in "{{key}}".', fr: 'Élément « {{id}} » introuvable dans « {{key}} ».' },
            { id, key: args.key ?? '' },
          ),
        )

      context.sessionManager.setMetadataEntries(context.sessionId, args.key!, updated)
      return helpers.success(
        serverT(
          {
            en: 'Removed item "{{id}}" from "{{key}}". {{count}} items remaining.',
            fr: 'Élément « {{id}} » supprimé de « {{key}} ». {{count}} éléments restants.',
          },
          { id, key: args.key ?? '', count: updated.length },
        ),
      )
    }

    return helpers.error(serverT({ en: 'Unexpected error', fr: 'Erreur inattendue' }))
  },
)
