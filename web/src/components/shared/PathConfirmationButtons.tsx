import { ScrollArea } from './ScrollArea'
import { useSessionStore, type PendingPathConfirmation } from '../../stores/session'
import { WarningSmallIcon } from './icons'
import { useSessionScope } from '../../stores/session/session-scope'
import { useT } from '../../hooks/useT'
import type { Translation } from '@shared/i18n/index.js'

interface PathConfirmationButtonsProps {
  confirmation: PendingPathConfirmation
}

function getReasonMessage(
  reason: PendingPathConfirmation['reason'],
  t: (tx: Translation, vars?: Record<string, string | number>) => string,
): {
  title: string
  description: string
} {
  switch (reason) {
    case 'sensitive_file':
      return {
        title: t({ en: 'Sensitive File Access', fr: 'Accès à un fichier sensible' }),
        description: t({
          en: 'Accessing files that may contain secrets',
          fr: 'Accès à des fichiers pouvant contenir des secrets',
        }),
      }
    case 'both':
      return {
        title: t({ en: 'Sensitive File Access', fr: 'Accès à un fichier sensible' }),
        description: t({
          en: 'Accessing sensitive files outside project',
          fr: 'Accès à des fichiers sensibles hors du projet',
        }),
      }
    case 'dangerous_command':
      return {
        title: t({ en: 'Dangerous Command', fr: 'Commande dangereuse' }),
        description: t({
          en: 'Running potentially dangerous command',
          fr: 'Exécution d’une commande potentiellement dangereuse',
        }),
      }
    case 'git_no_verify':
      return {
        title: t({ en: 'Git --no-verify', fr: 'Git --no-verify' }),
        description: t({
          en: 'Bypassing git hooks/pre-commit checks',
          fr: 'Contournement des hooks git / vérifications pre-commit',
        }),
      }
    case 'outside_workdir':
    default:
      return {
        title: t({ en: 'Path Access Request', fr: 'Demande d’accès au chemin' }),
        description: t({
          en: 'Accessing paths outside project directory',
          fr: 'Accès à des chemins hors du dossier du projet',
        }),
      }
  }
}

export function PathConfirmationButtons({ confirmation }: PathConfirmationButtonsProps) {
  const t = useT()
  const sessionId = useSessionScope()
  const confirmPath = useSessionStore((state) => state.confirmPath)
  const switchDangerLevel = useSessionStore((state) => state.switchDangerLevel)
  const { title, description } = getReasonMessage(confirmation.reason, t)

  const isSensitive = confirmation.reason === 'sensitive_file' || confirmation.reason === 'both'
  const borderColor = isSensitive ? 'border-red-500/50' : 'border-amber-500/50'
  const bgColor = isSensitive ? 'bg-red-500/10' : 'bg-amber-500/10'

  const isGitNoVerify = confirmation.reason === 'git_no_verify'

  const handleEnableDangerousAndAllow = async () => {
    if (!sessionId) return
    // Switching to dangerous mode makes the server auto-approve every pending
    // confirmation for the session, so this single call lets the whole batch
    // of tool calls continue. If the switch fails, fall back to approving just
    // this confirmation so the click is never a silent no-op.
    const switched = await switchDangerLevel(sessionId, 'dangerous')
    if (!switched) {
      confirmPath(sessionId, confirmation.callId, true, false)
    }
  }

  return (
    <div className={`border ${borderColor} ${bgColor} rounded p-3 my-2`}>
      <div className="flex items-center gap-2 mb-2">
        <WarningSmallIcon />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${isSensitive ? 'text-red-400' : 'text-amber-400'}`}>{title}</div>
          <div className="text-xs text-text-muted">{description}</div>
        </div>
      </div>

      <div className="text-xs text-text-muted mb-2">
        <span className="font-medium">{confirmation.tool}</span> {t({ en: 'wants to access:', fr: 'veut accéder à :' })}
      </div>

      <ScrollArea className="bg-bg-primary rounded p-2 mb-3 max-h-24">
        <ul className="space-y-0.5">
          {confirmation.paths.map((path, i) => (
            <li key={i} className={`text-xs font-mono ${isSensitive ? 'text-red-300' : 'text-amber-300'} break-all`}>
              {path}
            </li>
          ))}
        </ul>
      </ScrollArea>

      <div className="flex gap-2">
        <button
          onClick={() => sessionId && confirmPath(sessionId, confirmation.callId, false)}
          className="flex-1 px-3 py-1.5 text-xs font-medium rounded bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-secondary border border-border transition-colors"
        >
          {t({ en: 'Deny', fr: 'Refuser' })}
        </button>
        <button
          onClick={() => sessionId && confirmPath(sessionId, confirmation.callId, true, false)}
          className="flex-1 px-3 py-1.5 text-xs font-medium rounded bg-accent-primary hover:bg-accent-primary/80 text-text-primary transition-colors"
        >
          {t({ en: 'Allow', fr: 'Autoriser' })}
        </button>
        <button
          onClick={handleEnableDangerousAndAllow}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${isGitNoVerify ? 'hidden' : 'bg-red-600 hover:bg-red-700 text-white'}`}
          title={t({
            en: 'Enable dangerous mode and allow this request',
            fr: 'Activer le mode dangereux et autoriser cette demande',
          })}
        >
          {t({ en: 'Allow Everything', fr: 'Tout autoriser' })}
        </button>
      </div>
    </div>
  )
}
