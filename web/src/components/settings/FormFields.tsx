import { FormField } from './CRUDModal'

interface NameIdFieldsProps {
  name: string
  id: string
  nameLabel?: string
  idLabel?: string
  namePlaceholder?: string
  idPlaceholder?: string
  nameHint?: string
  readOnlyId?: boolean
  readOnlyHint?: string
  onNameChange: (name: string) => void
  onIdChange: (id: string) => void
}

export function NameIdFields({
  name,
  id,
  nameLabel = 'Name',
  idLabel = 'ID',
  namePlaceholder = 'My Item',
  idPlaceholder = 'my-item',
  nameHint,
  readOnlyId = false,
  readOnlyHint = '(read-only)',
  onNameChange,
  onIdChange,
}: NameIdFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField
        label={nameLabel}
        value={name}
        onChange={onNameChange}
        placeholder={namePlaceholder}
        hint={nameHint}
      />
      <FormField
        label={idLabel}
        value={id}
        onChange={onIdChange}
        readOnly={readOnlyId}
        placeholder={idPlaceholder}
        hint={readOnlyId ? readOnlyHint : undefined}
        mono
      />
    </div>
  )
}