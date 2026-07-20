import { useState, useCallback, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseButton } from './IconButton'

interface ModalProps {
  label?: ReactNode
  title?: string
  headerRight?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  minHeight?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
  onClose?: () => void
  isOpen?: boolean
  closeOnBackdropClick?: boolean
  closeOnEscape?: boolean
  showCloseButton?: boolean
  scrollable?: boolean
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[95vw] h-[90vh] flex-1',
}

export function Modal({
  label,
  title,
  headerRight,
  size = 'md',
  minHeight,
  children,
  footer,
  className,
  onClose,
  isOpen: controlledIsOpen,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  scrollable = true,
}: ModalProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false)
  const isControlled = controlledIsOpen !== undefined
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen

  const open = useCallback(() => {
    if (!isControlled) setInternalIsOpen(true)
  }, [isControlled])

  const close = useCallback(() => {
    if (!isControlled) setInternalIsOpen(false)
    onClose?.()
  }, [isControlled, onClose])

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const active = document.activeElement
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, close, closeOnEscape])

  const trigger =
    label &&
    (typeof label === 'string' ? (
      <button type="button" onClick={open} className={className}>
        {label}
      </button>
    ) : (
      <span onClick={open} className={className} style={{ cursor: 'pointer' }}>
        {label}
      </span>
    ))

  return (
    <>
      {trigger}
      {isOpen &&
        (typeof document !== 'undefined'
          ? createPortal(
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                  onClick={closeOnBackdropClick ? close : undefined}
                />
                <div
                  role="dialog"
                  className={`relative w-full ${sizeClasses[size]} max-h-[90vh] bg-bg-secondary border border-border rounded shadow-xl flex flex-col`}
                >
                  {(title || headerRight || showCloseButton) && (
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      {title && <h2 className="text-lg font-semibold text-text-primary">{title}</h2>}
                      <div className="flex items-center gap-2 ml-auto">
                        {headerRight}
                        {showCloseButton && <CloseButton onClick={close} aria-label="Close" />}
                      </div>
                    </div>
                  )}
                  <div
                    className={`p-4 flex-1 min-h-0${scrollable ? ' overflow-y-auto' : ' overflow-hidden flex flex-col'}`}
                    style={minHeight ? { minHeight } : undefined}
                  >
                    {children}
                  </div>
                  {footer && <div className="px-4 py-3 border-t border-border">{footer}</div>}
                </div>
              </div>,
              document.body,
            )
          : null)}
    </>
  )
}
