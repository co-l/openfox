import { ScrollArea } from '../../shared/ScrollArea'
import { useState, useRef, useEffect } from 'react'
import { FormField, ErrorBanner } from '../CRUDModal'
import { DropdownMenu } from '../../shared/DropdownMenu'
import { ModelPicker } from '../../shared/ModelPicker'
import { Toggle } from '../../shared/Toggle'
import { parseAllowedTools, serializeTools } from './tools'
import type { Provider } from '../../../stores/config'
import { useT } from '../../../hooks/useT'

interface AgentFormProps {
  formName: string
  formId: string
  formDescription: string
  formSubagent: boolean
  formTools: string[]
  formColor: string
  formModel: string | undefined
  formPrompt: string
  formError: string
  isReadOnly: boolean
  availableTools: { name: string; actions: string[]; topLevelOnly?: boolean; isMcp?: boolean; mcpServer?: string }[]
  providers: Provider[]
  onNameChange: (name: string) => void
  onIdChange: (id: string) => void
  onDescriptionChange: (desc: string) => void
  onSubagentChange: (subagent: boolean) => void
  onToolsChange: (tools: string[]) => void
  onColorChange: (color: string) => void
  onModelChange: (model: string | undefined) => void
  onPromptChange: (prompt: string) => void
}

export function AgentForm({
  formName,
  formId,
  formDescription,
  formSubagent,
  formTools,
  formColor,
  formModel,
  formPrompt,
  formError,
  isReadOnly,
  availableTools,
  providers,
  onNameChange,
  onIdChange,
  onDescriptionChange,
  onSubagentChange,
  onToolsChange,
  onColorChange,
  onModelChange,
  onPromptChange,
}: AgentFormProps) {
  const t = useT()
  const granularTools = parseAllowedTools(formTools)
  const filteredTools = availableTools.filter((t) => !(formSubagent && t.topLevelOnly) && !t.isMcp)
  const mcpTools = availableTools.filter((t) => t.isMcp && !(formSubagent && t.topLevelOnly))

  const mcpGroups: Map<string, typeof mcpTools> = new Map()
  for (const tool of mcpTools) {
    const server = tool.mcpServer ?? tool.name
    const group = mcpGroups.get(server) ?? []
    group.push(tool)
    mcpGroups.set(server, group)
  }

  const toggleToolAction = (toolName: string, action: string) => {
    const newGranular = new Map(granularTools)
    const current = newGranular.get(toolName) || new Set()
    const newActions = new Set(current)
    if (newActions.has(action)) {
      newActions.delete(action)
    } else {
      newActions.add(action)
    }
    if (newActions.size === 0) {
      newGranular.set(toolName, new Set())
    } else {
      newGranular.set(toolName, newActions)
    }
    onToolsChange(serializeTools(newGranular))
  }

  const toggleTool = (toolName: string) => {
    const newGranular = new Map(granularTools)
    if (newGranular.has(toolName)) {
      newGranular.delete(toolName)
    } else {
      newGranular.set(toolName, new Set())
    }
    onToolsChange(serializeTools(newGranular))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="space-y-3">
        {formError && <ErrorBanner message={formError} />}

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label={t({ en: 'Name', fr: 'Nom' })}
            value={formName}
            onChange={onNameChange}
            placeholder={t({ en: 'My Agent', fr: 'Mon agent' })}
            readOnly={isReadOnly}
          />
          <FormField
            label={t({ en: 'ID', fr: 'ID' })}
            value={formId}
            onChange={onIdChange}
            readOnly={true}
            placeholder="my_agent"
            hint={t({ en: '(read-only)', fr: '(lecture seule)' })}
            mono
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label={t({ en: 'Description', fr: 'Description' })}
            value={formDescription}
            onChange={onDescriptionChange}
            placeholder={t({ en: 'What this agent does', fr: 'Ce que fait cet agent' })}
            readOnly={isReadOnly}
          />
          <div>
            <label className="block text-xs text-text-secondary mb-1">{t({ en: 'Type', fr: 'Type' })}</label>
            <div className="flex items-center gap-3 h-[34px]">
              <button
                onClick={() => !isReadOnly && onSubagentChange(false)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  !formSubagent
                    ? 'bg-accent-primary/25 text-accent-primary'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
                } ${isReadOnly ? 'pointer-events-none opacity-60' : ''}`}
              >
                {t({ en: 'Agent', fr: 'Agent' })}
              </button>
              <button
                onClick={() => !isReadOnly && onSubagentChange(true)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  formSubagent
                    ? 'bg-accent-primary/25 text-accent-primary'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
                } ${isReadOnly ? 'pointer-events-none opacity-60' : ''}`}
              >
                {t({ en: 'Sub-agent', fr: 'Sous-agent' })}
              </button>
              <div className="flex items-center gap-1.5 ml-auto">
                <label className="text-xs text-text-secondary">{t({ en: 'Color', fr: 'Couleur' })}</label>
                <input
                  type="color"
                  value={formColor}
                  onChange={(e) => !isReadOnly && onColorChange(e.target.value)}
                  disabled={isReadOnly}
                  className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent"
                />
              </div>
            </div>
          </div>
        </div>

        {!isReadOnly && (
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              {t({ en: 'Model override', fr: 'Remplacement du modèle' })}
            </label>
            <ModelPicker
              providers={providers}
              value={formModel}
              onChange={onModelChange}
              defaultLabel={t({ en: 'Default (global model)', fr: 'Défaut (modèle global)' })}
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              {t({
                en: 'When set, this model will be used when this agent is active (overrides the session model).',
                fr: 'Lorsqu’il est défini, ce modèle sera utilisé quand cet agent est actif (remplace le modèle de session).',
              })}
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs text-text-secondary mb-1">{t({ en: 'Tools', fr: 'Outils' })}</label>
          <ScrollArea className="flex flex-wrap gap-1.5 p-2 bg-bg-tertiary border border-border rounded max-h-32">
            {filteredTools.map((tool) => {
              const isSelected = granularTools.has(tool.name)
              const hasActions = tool.actions.length > 0
              const selectedActions = granularTools.get(tool.name) || new Set()

              if (!hasActions) {
                return (
                  <button
                    key={tool.name}
                    onClick={() => !isReadOnly && toggleTool(tool.name)}
                    className={`px-1.5 py-0.5 rounded text-xs font-mono transition-colors flex items-center gap-1 ${
                      isSelected
                        ? 'bg-accent-primary/25 text-accent-primary'
                        : 'bg-bg-primary text-text-muted hover:text-text-secondary'
                    } ${isReadOnly ? 'pointer-events-none' : 'cursor-pointer'}`}
                  >
                    <span>{tool.name}</span>
                  </button>
                )
              }

              if (isReadOnly) {
                return (
                  <button
                    key={tool.name}
                    className="px-1.5 py-0.5 rounded text-xs font-mono flex items-center gap-1 bg-bg-primary text-text-muted pointer-events-none opacity-60"
                  >
                    <span>{tool.name}</span>
                    <span className="text-[10px]">*</span>
                  </button>
                )
              }

              return (
                <DropdownMenu
                  key={tool.name}
                  trigger={
                    <button
                      className={`px-1.5 py-0.5 rounded text-xs font-mono transition-colors flex items-center gap-1 ${
                        isSelected
                          ? 'bg-accent-primary/25 text-accent-primary'
                          : 'bg-bg-primary text-text-muted hover:text-text-secondary'
                      } cursor-pointer`}
                    >
                      <span>{tool.name}</span>
                      {selectedActions.size > 0 && <span className="text-[10px]">*</span>}
                    </button>
                  }
                  minWidth="160px"
                  items={[
                    ...tool.actions.map((action) => ({
                      label: (
                        <label className="flex items-center gap-2 cursor-pointer" htmlFor={`${tool.name}-${action}`}>
                          <input
                            type="checkbox"
                            id={`${tool.name}-${action}`}
                            checked={selectedActions.has(action)}
                            onChange={() => toggleToolAction(tool.name, action)}
                            disabled={isReadOnly}
                            className="w-3 h-3 rounded accent-accent-primary"
                          />
                          <span>{action}</span>
                        </label>
                      ),
                      closeOnClick: false,
                    })),
                    {
                      label: isSelected
                        ? t({ en: 'Deselect all', fr: 'Tout désélectionner' })
                        : t({ en: 'Select all', fr: 'Tout sélectionner' }),
                      closeOnClick: false,
                      onClick: () => {
                        if (isSelected) {
                          toggleTool(tool.name)
                        } else {
                          const newGranular = new Map(granularTools)
                          newGranular.set(tool.name, new Set(tool.actions))
                          onToolsChange(serializeTools(newGranular))
                        }
                      },
                    },
                  ]}
                />
              )
            })}
          </ScrollArea>
        </div>

        {mcpGroups.size > 0 &&
          (() => {
            const allMcpToolNames = new Set(mcpTools.map((t) => t.name))
            const hasMcpNone = granularTools.has('__mcp_none__')
            const hasMcpSpecific = [...granularTools.keys()].some((k) => allMcpToolNames.has(k))
            const mcpMode: 'all' | 'none' | 'partial' = hasMcpNone ? 'none' : hasMcpSpecific ? 'partial' : 'all'

            const setMcpMode = (mode: 'all' | 'none' | 'partial') => {
              const next = new Map(granularTools)
              for (const k of next.keys()) {
                if (k === '__mcp_none__' || allMcpToolNames.has(k)) {
                  next.delete(k)
                }
              }
              if (mode === 'none') {
                next.set('__mcp_none__', new Set())
              }
              if (mode === 'partial') {
                for (const name of allMcpToolNames) {
                  next.set(name, new Set())
                }
              }
              onToolsChange(serializeTools(next))
            }

            return (
              <div>
                <label className="block text-xs text-text-secondary mb-1">
                  {t({ en: 'MCP Tools', fr: 'Outils MCP' })}{' '}
                  <span className="text-text-muted font-normal">
                    {t({ en: '— from connected MCP servers', fr: '— issus des serveurs MCP connectés' })}
                  </span>
                </label>
                <div className="bg-bg-tertiary border border-border rounded overflow-hidden">
                  <div className="flex items-center gap-4 px-3 py-1.5">
                    {(['all', 'none', 'partial'] as const).map((mode) => (
                      <label
                        key={mode}
                        className={`flex items-center gap-1.5 text-xs cursor-pointer ${isReadOnly ? 'pointer-events-none opacity-60' : ''}`}
                      >
                        <input
                          type="radio"
                          name="mcp-mode"
                          checked={mcpMode === mode}
                          onChange={() => setMcpMode(mode)}
                          disabled={isReadOnly}
                          className="w-3 h-3 accent-accent-primary"
                        />
                        <span className={mcpMode === mode ? 'text-text-primary font-medium' : 'text-text-muted'}>
                          {mode === 'all'
                            ? t({ en: 'All', fr: 'Tous' })
                            : mode === 'none'
                              ? t({ en: 'None', fr: 'Aucun' })
                              : t({ en: 'Partial', fr: 'Partiel' })}
                          {mode === 'partial' && allMcpToolNames.size > 0 && (
                            <span className="ml-1 text-text-muted font-normal">
                              ({[...granularTools.keys()].filter((k) => allMcpToolNames.has(k)).length}/
                              {allMcpToolNames.size})
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                  {mcpMode === 'partial' &&
                    (() => {
                      const [search, setSearch] = useState('')
                      const [focusIdx, setFocusIdx] = useState(0)
                      const listRef = useRef<HTMLDivElement>(null)

                      const scrollToFocus = (idx: number) => {
                        const el = listRef.current?.querySelector(`[data-idx="${idx}"]`)
                        el?.scrollIntoView({ block: 'nearest' })
                      }

                      useEffect(() => {
                        scrollToFocus(focusIdx)
                      }, [focusIdx])
                      const filtered = search
                        ? mcpTools.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
                        : mcpTools

                      const handleKeyDown = (e: { key: string; preventDefault: () => void }) => {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          setFocusIdx((i) => Math.min(i + 1, filtered.length - 1))
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          setFocusIdx((i) => Math.max(i - 1, 0))
                        } else if (e.key === 'Enter' && filtered[focusIdx]) {
                          e.preventDefault()
                          toggleTool(filtered[focusIdx].name)
                        }
                      }

                      return (
                        <div>
                          <div className="px-3 py-2 border-b border-border">
                            <input
                              type="text"
                              value={search}
                              onChange={(e) => {
                                setSearch(e.target.value)
                                setFocusIdx(0)
                              }}
                              onKeyDown={handleKeyDown}
                              placeholder={t({ en: 'Search MCP tools...', fr: 'Rechercher des outils MCP...' })}
                              className="w-full px-2 py-1 text-xs bg-bg-primary border border-border rounded font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary"
                            />
                          </div>
                          <ScrollArea className="max-h-60">
                            <div ref={listRef}>
                              {filtered.map((tool, idx) => {
                                const isSelected = granularTools.has(tool.name)
                                const isFocused = idx === focusIdx
                                return (
                                  <div
                                    key={tool.name}
                                    data-idx={idx}
                                    className={`flex items-center justify-between px-3 py-1.5 transition-colors ${
                                      isFocused ? 'bg-bg-primary' : 'hover:bg-bg-primary/30'
                                    }`}
                                    onMouseEnter={() => setFocusIdx(idx)}
                                  >
                                    <span
                                      className={`text-xs font-mono ${isSelected ? 'text-text-primary' : 'text-text-muted'}`}
                                    >
                                      {tool.name}
                                    </span>
                                    <Toggle
                                      enabled={isSelected}
                                      onClick={() => toggleTool(tool.name)}
                                      label={tool.name}
                                    />
                                  </div>
                                )
                              })}
                              {filtered.length === 0 && (
                                <div className="px-3 py-2 text-xs text-text-muted">
                                  {t({
                                    en: 'No MCP tools match your search.',
                                    fr: 'Aucun outil MCP ne correspond à votre recherche.',
                                  })}
                                </div>
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      )
                    })()}
                </div>
              </div>
            )
          })()}
      </div>

      <div className="flex-1 min-h-[150px] pt-3 flex flex-col">
        <label className="block text-xs text-text-secondary mb-1">{t({ en: 'Prompt', fr: 'Invite' })}</label>
        <textarea
          value={formPrompt}
          onChange={(e) => !isReadOnly && onPromptChange(e.target.value)}
          readOnly={isReadOnly}
          placeholder={t({ en: 'Instructions for this agent...', fr: 'Instructions pour cet agent...' })}
          className={`h-80 w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-accent-primary ${isReadOnly ? 'opacity-60' : ''}`}
        />
      </div>
    </div>
  )
}
