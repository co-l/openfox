import { useState, useRef, useEffect } from 'react'
import { useSessionStore } from '../../stores/session'
import { useAgentsStore, getAgentColor } from '../../stores/agents'
import { AgentsModal } from '../settings/AgentsModal'

export function AgentSelector() {
  const currentMode = useSessionStore(state => state.currentSession?.mode)
  const switchMode = useSessionStore(state => state.switchMode)
  const defaults = useAgentsStore(state => state.defaults)
  const userItems = useAgentsStore(state => state.userItems)
  const fetchAgents = useAgentsStore(state => state.fetchAgents)
  const agents = [...defaults, ...userItems]
  const [isOpen, setIsOpen] = useState(false)
  const [showManager, setShowManager] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!currentMode) return null

  const topLevelAgents = agents.filter(a => !a.subagent)
  const currentAgent = topLevelAgents.find(a => a.id === currentMode)
  const displayName = currentAgent?.name ?? currentMode
  const currentColor = getAgentColor(agents, currentMode)

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
        title="Switch agent"
      >
        <span className="text-sm font-medium" style={{ color: currentColor }}>
          {displayName}
        </span>
        <svg
          className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && topLevelAgents.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-56 bg-bg-secondary border border-border rounded-lg shadow-lg overflow-hidden z-50">
          {topLevelAgents.map((agent, index) => {
            const isActive = agent.id === currentMode
            const color = getAgentColor(agents, agent.id)
            const shortcut = index < 4 ? `Ctrl+${index + 1}` : null
            return (
              <div
                key={agent.id}
                className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors group ${
                  isActive
                    ? 'bg-bg-tertiary'
                    : 'hover:bg-bg-tertiary cursor-pointer'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!isActive) switchMode(agent.id)
                    setIsOpen(false)
                  }}
                  className="flex-1 text-left flex items-center gap-2 min-w-0"
                >
                  <span className="font-medium truncate" style={{ color }}>
                    {agent.name}
                  </span>
                  {isActive && (
                    <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                {shortcut && (
                  <span className="shrink-0 px-1.5 py-0.5 text-[10px] bg-bg-tertiary text-text-muted rounded">
                    Ctrl+{index + 1}
                  </span>
                )}
                
              </div>
            )
          })}

          {/* Manage link */}
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false)
                setShowManager(true)
              }}
              className="w-full text-left px-3 py-1.5 rounded text-sm text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            >
              Manage Agents...
            </button>
          </div>
        </div>
      )}

      <AgentsModal isOpen={showManager} onClose={() => { setShowManager(false); setEditId(null) }} initialEditId={editId} />
    </div>
  )
}
