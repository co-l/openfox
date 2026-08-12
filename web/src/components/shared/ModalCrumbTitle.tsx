import type { ReactNode } from 'react'
import { ChevronRightIcon } from './icons'

interface ModalCrumbTitleProps {
  projectName: string
  children: ReactNode
}

/** Modal title in "project › action" breadcrumb form, e.g. "openfox › Tasks". */
export function ModalCrumbTitle({ projectName, children }: ModalCrumbTitleProps) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="truncate max-w-[240px] font-normal text-text-muted" title={projectName}>
        {projectName}
      </span>
      <ChevronRightIcon className="w-3 h-3 text-text-muted shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  )
}
