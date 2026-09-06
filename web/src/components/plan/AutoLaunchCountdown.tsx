import { useT } from '../../hooks/useT'
import { CountdownText } from '../shared/CountdownText'

/** Plain-text countdown under the favorite workflow button before auto-launch. */
export function AutoLaunchCountdown({
  deadline,
  onCancel,
  color,
}: {
  deadline: number
  onCancel: () => void
  color?: string
}) {
  const t = useT()
  return (
    <CountdownText
      testId="autolaunch-countdown"
      deadline={deadline}
      onCancel={onCancel}
      color={color}
      format={(seconds) => t({ en: '⌛ auto-launch {{seconds}}s', fr: '⌛ lancement auto {{seconds}}s' }, { seconds })}
    />
  )
}
