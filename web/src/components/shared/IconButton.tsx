import { ButtonHTMLAttributes, forwardRef } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** SVG path d attribute */
  icon: string
  /** Icon size class, default w-3.5 h-3.5 */
  iconSize?: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, iconSize = 'w-3.5 h-3.5', className = '', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={`p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors ${className}`}
        {...props}
      >
        <svg className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
        </svg>
      </button>
    )
  }
)

IconButton.displayName = 'IconButton'

const EDIT_ICON = 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'

export const EditButton = forwardRef<HTMLButtonElement, Omit<IconButtonProps, 'icon'>>(
  (props, ref) => <IconButton ref={ref} icon={EDIT_ICON} title="Edit" {...props} />
)

EditButton.displayName = 'EditButton'

const CLOSE_ICON = 'M6 18L18 6M6 6l12 12'

export const CloseButton = forwardRef<HTMLButtonElement, Omit<IconButtonProps, 'icon'>>(
  (props, ref) => <IconButton ref={ref} icon={CLOSE_ICON} {...props} />
)

CloseButton.displayName = 'CloseButton'
