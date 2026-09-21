import type { ReactNode } from 'react'

/**
 * Shared shell for the 24x24 stroke icons. Individual icons live in their own
 * file and only provide their path(s); this keeps the SVG boilerplate in one
 * place without inlining SVGs into feature components.
 */
export function IconBase({ className = 'w-5 h-5', children }: { className?: string; children: ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      {children}
    </svg>
  )
}
