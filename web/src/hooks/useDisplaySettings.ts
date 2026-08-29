import { SETTINGS_KEYS } from '../lib/resources'
import { useSetting } from './useSetting'

/**
 * Derived display preferences. Each value is its own setting key; before the
 * server answers, the documented default applies (matching the retired store).
 */
export function useDisplaySettings() {
  return {
    showThinking: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_THINKING, 'true').value === 'true',
    showVerboseToolOutput: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT, 'true').value === 'true',
    showStats: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_STATS, 'true').value === 'true',
    showAgentDefinitions: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS, 'true').value === 'true',
    showWorkflowBars: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS, 'true').value === 'true',
    showSyntaxHighlighting: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING, 'true').value === 'true',
    maxVisibleItems: Number(useSetting(SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS, '300').value),
    useNativeScrollbars: useSetting(SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS, 'false').value === 'true',
    useNativeScrollbarsCodeBlocks:
      useSetting(SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS, 'false').value === 'true',
    collapseLargeToolCalls: useSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_LARGE_TOOL_CALLS, 'false').value === 'true',
    deferCodeHighlightWhileStreaming:
      useSetting(SETTINGS_KEYS.DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING, 'false').value === 'true',
    feedVirtualization: useSetting(SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION, 'false').value === 'true',
    modelSelectorHeight: useSetting(SETTINGS_KEYS.DISPLAY_MODEL_SELECTOR_HEIGHT, 'default').value || 'default',
    collapseProvidersByDefault:
      useSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_PROVIDERS_BY_DEFAULT, 'false').value === 'true',
    collapseFavoritesByDefault:
      useSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_FAVORITES_BY_DEFAULT, 'false').value === 'true',
    modelFavoritesRaw: useSetting(SETTINGS_KEYS.DISPLAY_MODEL_FAVORITES, '[]').value,
  }
}
