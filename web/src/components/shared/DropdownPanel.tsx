import type { ReactNode } from 'react'

type DropdownPanelProps = {
  /** Coarse-pointer device: render a viewport-centered modal instead of an anchored panel. */
  isModal: boolean
  testId: string
  /** Modal fills most of the viewport (search-heavy pickers); otherwise it hugs its content. */
  fillViewport?: boolean
  /** Extra classes for the anchored (non-modal) variant, merged after the shared base. */
  anchoredClassName?: string
  onClose: () => void
  children: ReactNode
}

const MODAL_CENTER =
  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-1.5rem)] max-w-3xl rounded-xl'

export function DropdownPanel({
  isModal,
  testId,
  fillViewport = false,
  anchoredClassName = '',
  onClose,
  children,
}: DropdownPanelProps) {
  const modalSizing = fillViewport ? 'h-[calc(100dvh-6rem)] max-h-[calc(100dvh-6rem)]' : 'max-h-[calc(100dvh-3rem)]'

  return (
    <>
      {isModal && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />}
      <div
        data-testid={testId}
        data-panel={isModal ? 'modal' : 'anchored'}
        className={`bg-bg-secondary border border-border shadow-lg z-50 flex flex-col overflow-hidden ${
          isModal
            ? `${MODAL_CENTER} ${modalSizing}`
            : `absolute bottom-full right-0 mb-1 min-w-72 max-w-[90vw] rounded-lg ${anchoredClassName}`
        }`}
      >
        {children}
      </div>
    </>
  )
}
