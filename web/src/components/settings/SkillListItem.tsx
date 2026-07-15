import type { SkillInfo } from '../../stores/skills'
import { Toggle } from '../shared/Toggle'
import { CRUDListItemSimple } from './CRUDListItem'

interface SkillListItemProps {
  skill: SkillInfo
  isBuiltIn: boolean
  isConfirmingDelete: boolean
  onView: () => void
  onEdit?: () => void
  onDuplicate: () => void
  onDelete?: () => void
  onToggle: () => void
  readOnly?: boolean
}

export function SkillListItem({
  skill,
  isBuiltIn,
  isConfirmingDelete,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
  onToggle,
  readOnly = false,
}: SkillListItemProps) {
  return (
    <CRUDListItemSimple
      id={skill.id}
      name={skill.name}
      description={skill.description}
      isBuiltIn={isBuiltIn}
      isConfirmingDelete={isConfirmingDelete}
      onView={onView}
      onEdit={readOnly ? undefined : onEdit}
      onDuplicate={onDuplicate}
      onDelete={readOnly ? undefined : onDelete}
      actions={<Toggle enabled={skill.enabled} onClick={onToggle} label={`Activation for ${skill.name}`} />}
    />
  )
}
