import { useState } from 'react'
import type { InjectedFile, PromptContext, PromptContextMessage, PromptContextTool } from '@shared/types.js'
import { Modal } from './SelfContainedModal'
import { ChevronDownIcon } from './icons'

interface PromptInspectorProps {
  isOpen: boolean
  onClose: () => void
  promptContext: PromptContext
}

export function PromptInspector({ isOpen, onClose, promptContext }: PromptInspectorProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    systemPrompt: false,
    messages: true,
    tools: true,
    requestOptions: true,
    injectedFiles: true,
    userMessage: true,
  })

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Prompt Inspector" size="lg">
      <div className="space-y-4">
        {/* User Message Section */}
        <Section
          title="User Message"
          expanded={expandedSections['userMessage'] ?? true}
          onToggle={() => toggleSection('userMessage')}
        >
          <pre className="text-sm text-text-secondary whitespace-pre-wrap bg-bg-tertiary rounded p-3 max-h-48 overflow-auto">
            {promptContext.userMessage || '(empty)'}
          </pre>
        </Section>

        {promptContext.messages.length > 0 && (
          <Section
            title={`Prompt Messages (${promptContext.messages.length})`}
            expanded={expandedSections['messages'] ?? true}
            onToggle={() => toggleSection('messages')}
          >
            <div className="space-y-2">
              {promptContext.messages.map((message: PromptContextMessage, index: number) => (
                <div key={`${message.role}-${index}`} className="border border-border rounded overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary/50 text-xs text-text-muted">
                    <span className="font-mono text-text-primary">{message.role}</span>
                    <span className="rounded bg-bg-tertiary px-1.5 py-0.5">{message.source}</span>
                    {message.toolCallId && <span className="font-mono">{message.toolCallId}</span>}
                    {message.attachments && message.attachments.length > 0 && (
                      <span className="rounded bg-bg-tertiary px-1.5 py-0.5">
                        {message.attachments.length} attachment{message.attachments.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="border-b border-border px-3 py-2 text-xs text-text-muted">
                      {message.attachments.map((attachment: { filename: string }) => attachment.filename).join(', ')}
                    </div>
                  )}
                  <pre className="text-xs text-text-secondary whitespace-pre-wrap bg-bg-tertiary rounded-b p-3 max-h-64 overflow-auto font-mono">
                    {message.content || '(empty)'}
                  </pre>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section
          title={`Tools (${promptContext.tools.length})`}
          expanded={expandedSections['tools'] ?? true}
          onToggle={() => toggleSection('tools')}
        >
          <div className="space-y-2">
            {promptContext.tools.length === 0 && (
              <div className="text-sm text-text-muted">No tools sent with this request.</div>
            )}
            {promptContext.tools.map((tool: PromptContextTool, index: number) => (
              <div key={`${tool.name}-${index}`} className="bg-bg-tertiary rounded p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm text-text-primary">{tool.name}</span>
                  <span className="text-xs text-text-muted">parameters</span>
                </div>
                <div className="text-sm text-text-secondary">{tool.description}</div>
                <pre className="text-xs text-text-secondary whitespace-pre-wrap max-h-48 overflow-auto font-mono">
                  {JSON.stringify(tool.parameters, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Request Options"
          expanded={expandedSections['requestOptions'] ?? true}
          onToggle={() => toggleSection('requestOptions')}
        >
          <pre className="text-xs text-text-secondary whitespace-pre-wrap bg-bg-tertiary rounded p-3 max-h-48 overflow-auto font-mono lowercase">
            {JSON.stringify(promptContext.requestOptions, null, 2)}
          </pre>
        </Section>

        {/* Injected Files Section */}
        {promptContext.injectedFiles.length > 0 && (
          <Section
            title={`Injected Files (${promptContext.injectedFiles.length})`}
            expanded={expandedSections['injectedFiles'] ?? true}
            onToggle={() => toggleSection('injectedFiles')}
          >
            <div className="space-y-2">
              {promptContext.injectedFiles.map((file: InjectedFile, index: number) => (
                <FileItem 
                  key={index} 
                  file={file} 
                  expanded={expandedSections[`file-${index}`] ?? false}
                  onToggle={() => toggleSection(`file-${index}`)}
                />
              ))}
            </div>
          </Section>
        )}

        {/* System Prompt Section */}
        <Section
          title="System Prompt"
          expanded={expandedSections['systemPrompt'] ?? false}
          onToggle={() => toggleSection('systemPrompt')}
          badge={`${Math.round(promptContext.systemPrompt.length / 1000)}K chars`}
        >
          <pre className="text-xs text-text-secondary whitespace-pre-wrap bg-bg-tertiary rounded p-3 max-h-96 overflow-auto font-mono">
            {promptContext.systemPrompt}
          </pre>
        </Section>
      </div>
    </Modal>
  )
}

interface FileItemProps {
  file: { path: string; content: string; source: string }
  expanded: boolean
  onToggle: () => void
}

function FileItem({ file, expanded, onToggle }: FileItemProps) {
  return (
    <div className="bg-bg-tertiary rounded overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-2 hover:bg-bg-primary/30 transition-colors"
      >
        <ChevronDownIcon className={`w-3 h-3 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          file.source === 'global' ? 'bg-purple-500/20 text-purple-400' :
          file.source === 'project' ? 'bg-blue-500/20 text-blue-400' :
          'bg-green-500/20 text-green-400'
        }`}>
          {file.source}
        </span>
        <span className="text-sm text-text-primary font-mono truncate flex-1 text-left">
          {file.path}
        </span>
        {file.content && (
          <span className="text-xs text-text-muted">
            {Math.round(file.content.length / 1000)}K chars
          </span>
        )}
      </button>
      {expanded && file.content && (
        <div className="border-t border-border/50 p-2">
          <pre className="text-xs text-text-secondary whitespace-pre-wrap max-h-64 overflow-auto font-mono">
            {file.content}
          </pre>
        </div>
      )}
    </div>
  )
}

interface SectionProps {
  title: string
  expanded: boolean
  onToggle: () => void
  badge?: string
  children: React.ReactNode
}

function Section({ title, expanded, onToggle, badge, children }: SectionProps) {
  return (
    <div className="border border-border rounded overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-bg-tertiary/50 hover:bg-bg-tertiary transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronDownIcon className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <span className="font-medium text-text-primary">{title}</span>
          {badge && (
            <span className="text-xs text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">
              {badge}
            </span>
          )}
        </div>
      </button>
      {expanded && (
        <div className="p-3 border-t border-border">
          {children}
        </div>
      )}
    </div>
  )
}
