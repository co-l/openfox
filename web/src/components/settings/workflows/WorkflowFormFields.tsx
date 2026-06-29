const inputClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const labelClass = 'block text-[11px] text-text-secondary mb-0.5'

interface WorkflowFormFieldsProps {
  formName: string
  formId: string
  formDescription: string
  formMaxIterations: number
  formColor: string
  isReadOnly: boolean
  onNameChange: (name: string) => void
  onDescriptionChange: (v: string) => void
  onMaxIterationsChange: (v: number) => void
  onColorChange: (v: string) => void
}

export function WorkflowFormFields({
  formName,
  formId,
  formDescription,
  formMaxIterations,
  formColor,
  isReadOnly,
  onNameChange,
  onDescriptionChange,
  onMaxIterationsChange,
  onColorChange,
}: WorkflowFormFieldsProps) {
  return (
    <div className="flex items-end gap-3 mb-3 pb-3 border-b border-border flex-wrap">
      <div className="min-w-[140px]">
        <label className={labelClass}>Name</label>
        <input
          value={formName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Workflow name"
          className={`${inputClass} ${isReadOnly ? 'opacity-50' : ''}`}
          readOnly={isReadOnly}
        />
      </div>
      <div className="min-w-[100px]">
        <label className={labelClass}>ID</label>
        <input value={formId} readOnly className={`${inputClass} font-mono opacity-50`} />
      </div>
      <div className="flex-1 min-w-[140px]">
        <label className={labelClass}>Description</label>
        <input
          value={formDescription}
          onChange={(e) => !isReadOnly && onDescriptionChange(e.target.value)}
          readOnly={isReadOnly}
          placeholder="What does this workflow do?"
          className={`${inputClass} ${isReadOnly ? 'opacity-50' : ''}`}
        />
      </div>
      <div className="w-20">
        <label className={labelClass}>Max Iter.</label>
        <input
          type="number"
          value={formMaxIterations}
          onChange={(e) => !isReadOnly && onMaxIterationsChange(Number(e.target.value))}
          readOnly={isReadOnly}
          className={`${inputClass} font-mono ${isReadOnly ? 'opacity-50' : ''}`}
        />
      </div>
      <div>
        <label className={labelClass}>Color</label>
        <input
          type="color"
          value={formColor}
          onChange={(e) => !isReadOnly && onColorChange(e.target.value)}
          disabled={isReadOnly}
          className={`w-8 h-8 rounded border border-border bg-transparent ${isReadOnly ? 'opacity-50' : 'cursor-pointer'}`}
        />
      </div>
    </div>
  )
}
