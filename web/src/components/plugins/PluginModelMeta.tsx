import { useLocalizedString } from '../../hooks/useLocalizedString'
import { badgeToneClasses } from './plugin-ui-utils'
import { formatPluginPrice } from '../../lib/plugin-model-meta'
import type { PluginModelMetadataView } from '@shared/plugin.js'

/**
 * Renders plugin-contributed model metadata (pricing + badges) inside a model
 * row. Nothing renders when the plugin supplied no metadata.
 */
export function PluginModelMeta({ metadata }: { metadata?: PluginModelMetadataView }) {
  const localize = useLocalizedString()
  if (!metadata) return null

  const price = metadata.pricing ? formatPluginPrice(metadata.pricing) : null

  return (
    <>
      {(metadata.badges ?? []).map((badge, index) => (
        <span
          key={`${badge.label.en}-${index}`}
          data-plugin-badge
          className={`text-[10px] px-1 py-0.5 rounded border ${badgeToneClasses(badge.tone)}`}
        >
          {localize(badge.label)}
        </span>
      ))}
      {price ? (
        <span data-plugin-price className="text-[10px] text-text-muted whitespace-nowrap">
          {price}
        </span>
      ) : null}
    </>
  )
}
