import { useState } from 'react'
import { useT } from '../../hooks/useT'
import { authFetch } from '../../lib/api'
import { PlusLgIcon } from '../shared/icons'
import { CloseButton } from '../shared/CloseButton'
import { StepIndicator } from './StepIndicator'
import { ConnectLLMStep } from './steps/ConnectLLMStep'
import { ProjectsFolderStep } from './steps/ProjectsFolderStep'
import { VisionStep } from './steps/VisionStep'
import type { ProviderInfo } from './types'

interface OnboardingData {
  providers: ProviderInfo[]
  workdir: string
  visionFallback?: {
    enabled: boolean
    url?: string
    model?: string
    timeout: number
    backend?: 'ollama' | 'openai'
    providerModelRef?: string
    apiKey?: string
  }
}

interface OnboardingWizardProps {
  onComplete: () => void
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const t = useT()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<Partial<OnboardingData>>({})

  async function handleLLMComplete(providerData: { providers: ProviderInfo[] }) {
    setData((prev) => ({ ...prev, providers: providerData.providers }))
    setStep(2)
  }

  async function handleFolderComplete(folderData: { workdir: string }) {
    setData((prev) => ({ ...prev, ...folderData }))
    setStep(3)
  }

  async function handleVisionComplete(visionData: {
    visionFallback?: {
      enabled: boolean
      url?: string
      model?: string
      timeout: number
      backend?: 'ollama' | 'openai'
      providerModelRef?: string
      apiKey?: string
    }
  }) {
    setSaving(true)

    try {
      const configResponse = await authFetch('/api/init/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workdir: data.workdir,
          visionFallback: visionData.visionFallback,
        }),
      })

      if (!configResponse.ok) {
        throw new Error('Failed to save config')
      }

      onComplete()
    } catch (error) {
      console.error('Failed to save onboarding data:', error)
      setSaving(false)
    }
  }

  const handleStepClick = (targetStep: number) => {
    setStep(targetStep)
  }

  return (
    <div className="w-full max-w-xl mx-auto px-6 py-16 relative">
      <CloseButton onClick={onComplete} className="absolute top-4 right-4 p-2" variant="modal" size="xl" />
      <StepIndicator
        currentStep={step}
        totalSteps={3}
        labels={[
          t({ en: 'LLM Providers', fr: 'Fournisseurs LLM' }),
          t({ en: 'Projects Folder', fr: 'Dossier des projets' }),
          t({ en: 'Vision', fr: 'Vision' }),
        ]}
        onStepClick={handleStepClick}
      />
      <div className="max-w-xl mx-auto">
        {saving ? (
          <div className="text-center">
            <PlusLgIcon className="w-6 h-6" />
            <p className="mt-4 text-text-secondary">
              {t({ en: 'Saving your settings...', fr: 'Enregistrement de vos paramètres…' })}
            </p>
          </div>
        ) : (
          <>
            {step === 1 && <ConnectLLMStep onNext={handleLLMComplete} />}
            {step === 2 && <ProjectsFolderStep onNext={handleFolderComplete} />}
            {step === 3 && <VisionStep onNext={handleVisionComplete} />}
          </>
        )}
      </div>
    </div>
  )
}
