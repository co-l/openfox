import type { ReactNode } from 'react'

interface CreateInputSectionProps {
  icon: ReactNode
  title: string
  placeholder: string
  buttonLabel: string
  value: string
  onChange: (value: string) => void
  onCreate: () => void
  canCreate: boolean
  busy: boolean
}

export function CreateInputSection({
  icon,
  title,
  placeholder,
  buttonLabel,
  value,
  onChange,
  onCreate,
  canCreate,
  busy,
}: CreateInputSectionProps) {
  return (
    <div>
      <p className="text-sm font-medium text-text-primary mb-2">{title}</p>
      <div className="flex items-center gap-2 px-3 py-2 rounded border border-border bg-bg-primary focus-within:border-accent-primary mb-3">
        <span className="w-4 h-4 shrink-0 text-text-muted flex items-center">{icon}</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canCreate) onCreate()
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-text-primary outline-none font-mono placeholder-text-muted"
        />
      </div>
      <button
        onClick={onCreate}
        disabled={!canCreate || busy}
        className="w-full px-4 py-2 text-sm rounded bg-accent-primary text-white hover:opacity-90 transition-colors disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  )
}
