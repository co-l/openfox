import { useRef } from 'react'
import { Modal } from '../shared/Modal'
import { PlusLgIcon } from '../shared/icons'
import { ConnectLLMStep, type ConnectLLMStepHandle } from '../onboarding/steps/ConnectLLMStep'
import { useT } from '../../hooks/useT'
import { PluginZone } from '../plugins/PluginZone'

interface ManageProvidersModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ManageProvidersModal({ isOpen, onClose }: ManageProvidersModalProps) {
  const stepRef = useRef<ConnectLLMStepHandle>(null)
  const t = useT()

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t({ en: 'Manage Providers', fr: 'Gérer les fournisseurs' })}
      size="lg"
      footer={
        <PluginZone id="modal.footer" className="w-full">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => stepRef.current?.addProvider()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-border text-sm text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
            >
              <PlusLgIcon className="w-4 h-4" />
              {t({ en: 'Add Provider', fr: 'Ajouter un fournisseur' })}
            </button>
            <button
              type="button"
              onClick={() => stepRef.current?.submit()}
              className="px-5 py-2 bg-accent-primary text-text-primary rounded-lg text-sm font-medium hover:bg-accent-primary/90 transition-colors"
            >
              {t({ en: 'Done', fr: 'Terminé' })}
            </button>
          </div>
        </PluginZone>
      }
    >
      <PluginZone id="providers.modal">
        <ConnectLLMStep ref={stepRef} onNext={onClose} embedded />
      </PluginZone>
    </Modal>
  )
}
