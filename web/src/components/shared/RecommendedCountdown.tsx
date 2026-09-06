import type { Translation } from '@shared/i18n/index.js'
import { useT } from '../../hooks/useT'
import { useCountdownSeconds } from '../../hooks/useCountdownSeconds'

/** The auto-answered option always wears the themed accent border + glow. */
export const RECOMMENDED_CLASS = 'border-accent-primary shadow-[0_0_10px_rgba(var(--color-accent-primary)/0.45)]'

const COUNTDOWN_GLYPH: Translation = { en: '⌛ auto-answer {{seconds}}s', fr: '⌛ choix auto {{seconds}}s' }

interface RecommendedCountdownProps {
  deadline: number
  onCancel: () => void
}

/**
 * Countdown living inside the auto-answered answer block: a flowing line on
 * mobile (its own row under the option title, before the description), pinned
 * to the top-right of the block on desktop. Clicking it cancels the countdown
 * and never selects the option. Plain spans only — it renders nested inside
 * the option <button>, where block/interactive elements are not allowed.
 */
export function RecommendedCountdown({ deadline, onCancel }: RecommendedCountdownProps) {
  const t = useT()
  const seconds = useCountdownSeconds(deadline)

  const cancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    onCancel()
  }

  return (
    <span
      data-testid="autoanswer-countdown"
      onClick={cancel}
      title={t({ en: 'Cancel', fr: 'Annuler' })}
      className="flex items-center justify-end gap-1 text-[10px] leading-none opacity-90 pt-0.5 cursor-pointer @md:absolute @md:top-1 @md:right-2 @md:pt-0"
      style={{ color: 'rgb(var(--color-accent-primary))' }}
    >
      <span>{t(COUNTDOWN_GLYPH, { seconds })}</span>
      <span className="px-0.5 opacity-70 hover:opacity-100">×</span>
    </span>
  )
}
