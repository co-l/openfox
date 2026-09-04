import type { SkillInfo } from '../../lib/skills-actions'
import { Toggle } from '../shared/Toggle'
import { CRUDListItemSimple } from './CRUDListItem'
import { formatTokens } from '../../lib/mcp-utils'
import { useT } from '../../hooks/useT'

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
  const t = useT()

  return (
    <CRUDListItemSimple
      id={skill.id}
      name={skill.name}
      description={skill.description}
      extraBadge={
        skill.estimatedTokens !== undefined && skill.estimatedTokens > 0 ? (
          <span className="text-xs text-text-muted">
            {t({ en: '{{tokens}} tokens', fr: '{{tokens}} tokens' }, { tokens: formatTokens(skill.estimatedTokens) })}
          </span>
        ) : undefined
      }
      isBuiltIn={isBuiltIn}
      isConfirmingDelete={isConfirmingDelete}
      onView={onView}
      onEdit={readOnly ? undefined : onEdit}
      onDuplicate={onDuplicate}
      onDelete={readOnly ? undefined : onDelete}
      actions={
        <Toggle
          enabled={skill.enabled}
          onClick={onToggle}
          label={t({ en: 'Activation for {{name}}', fr: 'Activation pour {{name}}' }, { name: skill.name })}
        />
      }
    />
  )
}
