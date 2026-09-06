import { useT } from '../../hooks/useT'
import { useCountdownSeconds } from '../../hooks/useCountdownSeconds'
import { CloseButton } from './CloseButton'

export interface CountdownTextProps {
  deadline: number
  onCancel: () => void
  /** Render the countdown label; receives the remaining whole seconds. */
  format: (seconds: number) => string
  /** Text color (the themed workflow/button accent). */
  color?: string
  testId?: string
}

/** Plain-text countdown (no background/border), tiny font, themed color. */
export function CountdownText({ deadline, onCancel, format, color, testId }: CountdownTextProps) {
  const t = useT()
  const seconds = useCountdownSeconds(deadline)

  return (
    <div
      data-testid={testId}
      className="flex items-center gap-1 text-[10px] leading-none opacity-80"
      style={{ color: color ?? 'rgb(var(--color-accent-primary))' }}
    >
      <span>{format(seconds)}</span>
      <CloseButton
        onClick={onCancel}
        size="sm"
        className="p-0.5 opacity-70 hover:opacity-100"
        aria-label={t({ en: 'Cancel', fr: 'Annuler' })}
      />
    </div>
  )
}
