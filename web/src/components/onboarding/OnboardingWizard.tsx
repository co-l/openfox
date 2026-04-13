import { useState, useEffect } from 'react'
import { authFetch } from '../../lib/api'
import type { Backend } from '../../stores/config'
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard'

const COMMON_PORTS = [8000, 11434, 8080]

interface ProviderInfo {
  id: string
  name: string
  url: string
  backend: Backend
  model: string | null
}

function getBackendDisplayName(backend: Backend): string {
  switch (backend) {
    case 'vllm': return 'vLLM'
    case 'sglang': return 'SGLang'
    case 'ollama': return 'Ollama'
    case 'llamacpp': return 'llama.cpp'
    case 'openai': return 'OpenAI'
    case 'anthropic': return 'Anthropic'
    case 'auto': return 'Auto'
    case 'unknown': return 'Unknown'
    default: return backend
  }
}

function Spinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6'
  return (
    <svg className={`animate-spin ${sizeClass} text-text-muted`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

interface StepIndicatorProps {
  currentStep: number
  totalSteps: number
  labels: string[]
}

function StepIndicator({ currentStep, totalSteps, labels }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
              i + 1 < currentStep
                ? 'bg-accent-primary text-white'
                : i + 1 === currentStep
                  ? 'bg-accent-primary/25 text-white border-2 border-accent-primary'
                  : 'bg-bg-tertiary text-text-muted'
            }`}
          >
            {i + 1 < currentStep ? '✓' : i + 1}
          </div>
          <span className={`ml-2 text-sm ${i + 1 === currentStep ? 'text-text-primary' : 'text-text-muted'}`}>
            {labels[i]}
          </span>
          {i < totalSteps - 1 && (
            <div className={`w-8 h-px mx-4 ${i + 1 < currentStep ? 'bg-accent-primary' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

interface ConnectLLMStepProps {
  onNext: (data: { providers: ProviderInfo[] }) => void
}

function ConnectLLMStep({ onNext }: ConnectLLMStepProps) {
  const [existingProviders, setExistingProviders] = useState<ProviderInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [customBackend, setCustomBackend] = useState<Backend>('auto')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; model?: string; error?: string } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [editedName, setEditedName] = useState('')

  useEffect(() => {
    fetchExistingProviders()
  }, [])

  async function fetchExistingProviders() {
    try {
      const response = await authFetch('/api/providers')
      if (response.ok) {
        const data = await response.json() as { providers: Array<{ id: string; name: string; url: string; backend: Backend }> }
        const mapped = data.providers.map(p => ({
          id: p.id,
          name: p.name,
          url: p.url,
          backend: p.backend,
          model: null,
        }))
        setExistingProviders(mapped)
        setProviders(mapped)
      }
    } catch {
      // ignore
    }
  }

  async function testConnection(url: string) {
    setTesting(true)
    setTestResult(null)

    try {
      const response = await authFetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await response.json() as { success: boolean; backend?: Backend; model?: string | null; error?: string }

      if (data.success) {
        setCustomBackend(data.backend ?? 'auto')
        setTestResult({ success: true, model: data.model ?? undefined })
      } else {
        setTestResult({ success: false, error: data.error ?? 'Connection failed' })
      }
    } catch (error) {
      setTestResult({ success: false, error: error instanceof Error ? error.message : 'Connection failed' })
    }

    setTesting(false)
  }

  function addProvider() {
    if (!customUrl) return

    const name = customName || `Provider ${providers.length + 1}`
    const newProvider: ProviderInfo = {
      id: `temp-${Date.now()}`,
      name,
      url: customUrl,
      backend: testResult?.success ? customBackend : 'auto',
      model: testResult?.success ? testResult.model ?? null : null,
    }

    setProviders([...providers, newProvider])
    setCustomName('')
    setCustomUrl('')
    setTestResult(null)
  }

  function removeProvider(id: string) {
    setRemoving(id)
    const isExisting = existingProviders.some(p => p.id === id)

    if (isExisting) {
      authFetch(`/api/providers/${id}`, { method: 'DELETE' })
        .then(() => {
          setProviders(providers.filter(p => p.id !== id))
          setExistingProviders(existingProviders.filter(p => p.id !== id))
          setRemoving(null)
        })
        .catch(() => {
          setRemoving(null)
        })
    } else {
      setProviders(providers.filter(p => p.id !== id))
      setRemoving(null)
    }
  }

  async function handleSubmit() {
    for (const provider of providers) {
      if (provider.id.startsWith('temp-') || !existingProviders.some(e => e.id === provider.id)) {
        const response = await authFetch('/api/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: provider.name,
            url: provider.url,
            backend: provider.backend,
            model: provider.model,
          }),
        })
        if (!response.ok) {
          console.error('Failed to add provider', provider)
        }
      }
    }

    const validProviders = providers.filter(p => !p.id.startsWith('temp-'))
    onNext({ providers: validProviders })
  }

  const hasProviders = providers.length > 0

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="text-2xl font-bold text-text-primary mb-2">LLM Providers</h2>
      <p className="text-text-secondary mb-8">Manage your LLM server connections</p>

      <StepIndicator currentStep={1} totalSteps={3} labels={['LLM Server', 'Projects Folder', 'Vision']} />

      <div className="space-y-4">
        {providers.length > 0 ? (
          <div className="space-y-2">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between bg-bg-secondary rounded-lg p-4 border border-border"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-accent-primary/25 text-accent-primary rounded text-xs font-medium">
                      {getBackendDisplayName(provider.backend)}
                    </span>
                    {editingProviderId === provider.id ? (
                      <input
                        type="text"
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setProviders(providers.map(p => p.id === provider.id ? { ...p, name: editedName } : p))
                            setEditingProviderId(null)
                          }
                          if (e.key === 'Escape') setEditingProviderId(null)
                        }}
                        onBlur={() => {
                          setProviders(providers.map(p => p.id === provider.id ? { ...p, name: editedName } : p))
                          setEditingProviderId(null)
                        }}
                        className="px-2 py-0.5 bg-bg-primary border border-accent-primary rounded text-text-primary text-sm focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="text-text-primary font-medium cursor-pointer hover:text-accent-primary"
                        onClick={() => {
                          setEditingProviderId(provider.id)
                          setEditedName(provider.name)
                        }}
                        title="Click to edit"
                      >
                        {provider.name}
                      </span>
                    )}
                  </div>
                  <p className="text-text-muted text-sm mt-1">{provider.url}</p>
                  {provider.model && (
                    <p className="text-text-secondary text-xs mt-0.5">Model: {provider.model}</p>
                  )}
                </div>
                <button
                  onClick={() => removeProvider(provider.id)}
                  disabled={removing === provider.id}
                  className="p-2 text-text-muted hover:text-red-500 transition-colors disabled:opacity-50"
                  title="Remove provider"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-bg-secondary rounded-lg p-8 text-center border border-border">
            <p className="text-text-muted">No providers configured yet</p>
          </div>
        )}

        {showAddForm ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (customUrl) addProvider()
            }}
            className="space-y-4 p-4 bg-bg-tertiary rounded-lg"
          >
            <div>
              <label className="block text-sm text-text-secondary mb-2">Presets</label>
              <div className="grid grid-cols-3 gap-2">
                {COMMON_PORTS.map((port) => (
                  <button
                    type="button"
                    key={port}
                    onClick={() => {
                      setCustomUrl(`http://localhost:${port}`)
                      setTestResult(null)
                    }}
                    className={`p-2 rounded border text-center text-sm transition-colors ${
                      customUrl === `http://localhost:${port}`
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-border hover:border-text-muted text-text-secondary'
                    }`}
                  >
                    localhost:{port}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">Or enter address manually</label>
              <input
                type="text"
                name="url"
                value={customUrl}
                onChange={(e) => {
                  setCustomUrl(e.target.value)
                  setTestResult(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    testConnection(customUrl)
                  }
                }}
                placeholder="http://localhost:8000"
                className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
              />
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">Provider name (optional)</label>
              <input
                type="text"
                name="name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addProvider()
                  }
                }}
                placeholder="My LLM Server"
                className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
              />
            </div>

            {testResult && (
              <div className={`p-3 rounded-lg ${testResult.success ? 'bg-accent-primary/10' : 'bg-red-500/10'}`}>
                {testResult.success ? (
                  <p className="text-accent-primary font-medium">
                    ✓ Connected to {getBackendDisplayName(customBackend)}
                    {testResult.model && ` (${testResult.model})`}
                  </p>
                ) : (
                  <p className="text-red-500">{testResult.error}</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => testConnection(customUrl)}
                disabled={!customUrl || testing}
                className="flex-1 px-4 py-2 bg-bg-secondary border border-border rounded-lg hover:border-text-muted disabled:opacity-50"
              >
                {testing ? <Spinner size="sm" /> : 'Test Connection'}
              </button>
              <button
                type="submit"
                disabled={!customUrl}
                className="flex-1 px-4 py-2 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {testResult?.success ? 'Add Provider ✓' : 'Add Provider'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowAddForm(false)
                setCustomName('')
                setCustomUrl('')
                setTestResult(null)
              }}
              className="w-full text-center text-text-muted hover:text-text-secondary text-sm"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-bg-secondary border border-dashed border-border rounded-lg text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
          >
            <PlusIcon />
            Add Provider
          </button>
        )}

        <button
          onClick={handleSubmit}
          disabled={!hasProviders}
          className="w-full mt-6 px-6 py-3 bg-accent-primary text-white rounded-lg font-medium hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

interface ProjectsFolderStepProps {
  onNext: (data: { workdir: string }) => void
}

function ProjectsFolderStep({ onNext }: ProjectsFolderStepProps) {
  const [workdir, setWorkdir] = useState('')
  const [browsing, setBrowsing] = useState(false)

  useEffect(() => {
    authFetch('/api/config')
      .then(r => r.json())
      .then(data => {
        if (data.workdir) {
          setWorkdir(data.workdir)
        } else {
          fetch('/api/directories?path=' + encodeURIComponent('/home'))
            .then(r => r.json())
            .then(dirData => {
              if (dirData.current) {
                setWorkdir(dirData.current)
              }
            })
            .catch(() => {})
        }
      })
      .catch(() => {
        fetch('/api/directories?path=' + encodeURIComponent('/home'))
          .then(r => r.json())
          .then(data => {
            if (data.current) {
              setWorkdir(data.current)
            }
          })
          .catch(() => {})
      })
  }, [])

  async function browseFolder() {
    setBrowsing(true)
    const input = document.createElement('input')
    input.type = 'file'
    input.webkitdirectory = true
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files
      if (files && files.length > 0) {
        const path = (files[0] as File & { path?: string }).path
        if (path) {
          setWorkdir(path.replace(/\/[^/]*$/, ''))
        }
      }
      setBrowsing(false)
    }
    input.click()
  }

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="text-2xl font-bold text-text-primary mb-2">Your Projects Folder</h2>
      <p className="text-text-secondary mb-8">Where should OpenFox create project folders?</p>

      <StepIndicator currentStep={2} totalSteps={3} labels={['LLM Server', 'Projects Folder', 'Vision']} />

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-text-secondary mb-1">Workspace directory</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              placeholder="/home/user/projects"
              className="flex-1 px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
            />
            <button
              onClick={browseFolder}
              disabled={browsing}
              className="px-4 py-2 bg-bg-secondary border border-border rounded-lg hover:border-text-muted disabled:opacity-50"
            >
              {browsing ? <Spinner size="sm" /> : 'Browse'}
            </button>
          </div>
        </div>

        <button
          onClick={() => onNext({ workdir })}
          disabled={!workdir}
          className="w-full mt-6 px-6 py-3 bg-accent-primary text-white rounded-lg font-medium hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

interface VisionStepProps {
  onNext: (data: { visionFallback?: { enabled: boolean; url: string; model: string; timeout: number } }) => void
}

function VisionStep({ onNext }: VisionStepProps) {
  const [enabled, setEnabled] = useState(false)
  const [url, setUrl] = useState('http://localhost:11434')
  const [model, setModel] = useState('qwen3-vl:2b')
  const { copied, copy } = useCopyToClipboard()

  useEffect(() => {
    authFetch('/api/config')
      .then(r => r.json())
      .then(data => {
        if (data.visionFallback) {
          setEnabled(data.visionFallback.enabled)
          setUrl(data.visionFallback.url)
          setModel(data.visionFallback.model)
        }
      })
      .catch(() => {})
  }, [])

  function handleFinish(skip: boolean) {
    if (skip) {
      onNext({})
      return
    }

    onNext({
      visionFallback: {
        enabled,
        url,
        model,
        timeout: 120,
      },
    })
  }

  return (
    <div className="max-w-xl mx-auto">
      <h2 className="text-2xl font-bold text-text-primary mb-2">Vision (Optional)</h2>
      <p className="text-text-secondary mb-8">Configure a vision model for non-vision models</p>

      <StepIndicator currentStep={3} totalSteps={3} labels={['LLM Server', 'Projects Folder', 'Vision']} />

      <div className="space-y-6">
        <div className="bg-bg-secondary rounded-lg p-4 border border-border">
          <p className="text-text-secondary text-sm mb-2">To enable vision support, you need an Ollama server with a vision model:</p>
          <a
            href="https://ollama.com/download"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary hover:underline text-sm"
          >
            Download Ollama
          </a>
          <div className="mt-3 p-2 bg-bg-primary rounded border border-border flex items-center justify-between gap-2">
            <code className="text-text-secondary text-xs">ollama pull qwen3-vl:2b</code>
            <button
              onClick={() => copy('ollama pull qwen3-vl:2b')}
              className="text-text-muted hover:text-text-primary transition-colors"
              title="Copy"
            >
              {copied ? (
                <svg className="w-4 h-4 text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-5 h-5 rounded border-border bg-bg-secondary text-accent-primary focus:ring-accent-primary"
          />
          <span className="text-text-primary">Enable vision fallback for non-vision models</span>
        </label>

        {enabled && (
          <div className="space-y-4 pl-8">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Vision server URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
              />
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">Vision model name</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="qwen3-vl:2b"
                className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4">
          <button
            onClick={() => handleFinish(true)}
            className="text-text-muted hover:text-text-secondary text-sm underline"
          >
            Skip for now
          </button>
          <button
            onClick={() => handleFinish(false)}
            className="px-6 py-3 bg-accent-primary text-white rounded-lg font-medium hover:bg-accent-primary/90 transition-colors"
          >
            Finish Setup
          </button>
        </div>
      </div>
    </div>
  )
}

interface OnboardingData {
  providers: ProviderInfo[]
  workdir: string
  visionFallback?: { enabled: boolean; url: string; model: string; timeout: number }
}

interface OnboardingWizardProps {
  onComplete: () => void
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-4 right-4 p-2 text-text-muted hover:text-text-primary transition-colors"
      title="Close"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<Partial<OnboardingData>>({})

  async function handleLLMComplete(providerData: { providers: ProviderInfo[] }) {
    setData(prev => ({ ...prev, providers: providerData.providers }))
    setStep(2)
  }

  async function handleFolderComplete(folderData: { workdir: string }) {
    setData(prev => ({ ...prev, ...folderData }))
    setStep(3)
  }

  async function handleVisionComplete(visionData: { visionFallback?: { enabled: boolean; url: string; model: string; timeout: number } }) {
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

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-8 relative">
      <CloseButton onClick={onComplete} />
      <div className="w-full max-w-2xl">
        {saving ? (
          <div className="text-center">
            <Spinner size="md" />
            <p className="mt-4 text-text-secondary">Saving your settings...</p>
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