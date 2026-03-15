import { useState } from 'react'
import type { PromptContext } from '@openfox/shared'
import { Modal } from './Modal'

interface PromptInspectorProps {
  isOpen: boolean
  onClose: () => void
  promptContext: PromptContext
}

export function PromptInspector({ isOpen, onClose, promptContext }: PromptInspectorProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    systemPrompt: false,
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

        {/* Injected Files Section */}
        {promptContext.injectedFiles.length > 0 && (
          <Section
            title={`Injected Files (${promptContext.injectedFiles.length})`}
            expanded={expandedSections['injectedFiles'] ?? true}
            onToggle={() => toggleSection('injectedFiles')}
          >
            <div className="space-y-2">
              {promptContext.injectedFiles.map((file, index) => (
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
        <svg
          className={`w-3 h-3 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
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
          <svg
            className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
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
