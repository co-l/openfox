import { useState, useRef } from 'react'
import type { WorkflowScope } from '@shared/types.js'
import { useT } from '../../hooks/useT'
import { SCOPE_LABELS } from '../../lib/workflow-scope'
import { useClickOutside } from '../../hooks/useClickOutside'

/** Workflow launch pill with an optional sub-group menu, shared by the
 * post-plan choice point (workflow buttons row) everywhere it renders. */
export function WorkflowButton({
  workflowName,
  scope,
  color,
  bg,
  bgHover,
  border,
  subGroups,
  onLaunch,
}: {
  workflowName: string
  scope: WorkflowScope
  color: string
  bg: string
  bgHover: string
  border: string
  subGroups?: string[]
  onLaunch: (subGroup?: string) => void
}) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen)

  const hasSubGroups = subGroups && subGroups.length > 0

  return (
    <div className="relative flex">
      <button
        onClick={() => onLaunch()}
        data-testid="workflow-run-button"
        className={`px-4 py-1.5 text-sm font-medium transition-colors ${hasSubGroups ? 'rounded-l' : 'rounded'}`}
        style={{
          backgroundColor: bg,
          color,
          border: `1px solid ${border}`,
          ...(hasSubGroups ? { borderRight: 'none' } : {}),
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = bgHover
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = bg
        }}
      >
        ▶ {workflowName}{' '}
        <span className="text-[10px] font-normal opacity-70 whitespace-nowrap">{SCOPE_LABELS[scope]}</span>
      </button>
      {hasSubGroups && (
        <div ref={menuRef} className="relative flex">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="px-2.5 py-1.5 rounded-r text-sm font-medium transition-colors flex items-center"
            style={{ backgroundColor: bg, color, border: `1px solid ${border}` }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = bgHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = bg
            }}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="absolute top-full right-0 mt-1 w-40 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden">
              <button
                onClick={() => {
                  onLaunch()
                  setMenuOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                {t({ en: 'Full workflow', fr: 'Workflow complet' })}
              </button>
              <div className="border-t border-border/50" />
              {subGroups.map((sg) => (
                <button
                  key={sg}
                  onClick={() => {
                    onLaunch(sg)
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  {sg}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
