import { ScrollArea } from '../../shared/ScrollArea'
import { useState, useEffect, useMemo } from 'react'
import { SETTINGS_KEYS, setSetting } from '../../../lib/resources'
import { useSetting } from '../../../hooks/useSetting'
import { ThemeEditor } from '../ThemeEditor'
import { useT } from '../../../hooks/useT'
import { useLocaleStore } from '../../../stores/locale'
import type { Translation } from '@shared/i18n/index.js'
import {
  detectAvailableFonts,
  extractPrimaryFamily,
  toFontFamilyValue,
  resolveDefaultFamily,
  DEFAULT_TERMINAL_FONT,
} from '../../../lib/fonts'

function ThemePicker() {
  return <ThemeEditor />
}

interface ToggleDefinition {
  key: string
  label: Translation
  description: Translation
  defaultValue?: string
}

const FEED_TOGGLES: ToggleDefinition[] = [
  {
    key: SETTINGS_KEYS.DISPLAY_SHOW_THINKING,
    label: { en: 'Show thinking blocks', fr: 'Afficher les blocs de réflexion' },
    description: {
      en: 'Display AI reasoning content in the feed',
      fr: 'Affiche le contenu de raisonnement de l’IA dans le fil',
    },
  },
  {
    key: SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT,
    label: { en: 'Show expanded tool output', fr: 'Afficher la sortie détaillée des outils' },
    description: {
      en: 'Always show full tool call details instead of compact view',
      fr: 'Affiche toujours le détail complet des appels d’outils au lieu d’une vue compacte',
    },
  },
  {
    key: SETTINGS_KEYS.DISPLAY_SHOW_STATS,
    label: { en: 'Show stats bar', fr: 'Afficher la barre de statistiques' },
    description: {
      en: 'Display model, tokens, and timing information',
      fr: 'Affiche les informations sur le modèle, les jetons et le temps',
    },
  },
  {
    key: SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS,
    label: { en: 'Show agent definitions', fr: 'Afficher les définitions d’agents' },
    description: {
      en: 'Display agent definition injections in the feed',
      fr: 'Affiche les injections de définitions d’agents dans le fil',
    },
  },
  {
    key: SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS,
    label: { en: 'Show workflow bars', fr: 'Afficher les barres de workflow' },
    description: {
      en: 'Display workflow start and end markers',
      fr: 'Affiche les marqueurs de début et de fin de workflow',
    },
  },
]

const PERF_TOGGLES: ToggleDefinition[] = [
  {
    key: SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS,
    label: {
      en: 'Use native scrollbars in tool calls',
      fr: 'Utiliser les barres de défilement natives dans les appels d’outils',
    },
    description: {
      en: 'Swap custom styled scrollbars for native ones in tool call views (file previews, arguments, results). Faster, but native scrollbars look different on some platforms.',
      fr: 'Remplace les barres de défilement personnalisées par des barres natives dans les vues d’appels d’outils (aperçus de fichiers, arguments, résultats). Plus rapide, mais l’apparence diffère selon les plateformes.',
    },
    defaultValue: 'false',
  },
  {
    key: SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS,
    label: {
      en: 'Use native scrollbars in code blocks',
      fr: 'Utiliser les barres de défilement natives dans les blocs de code',
    },
    description: {
      en: 'Swap custom styled scrollbars for native ones in markdown code blocks and tables.',
      fr: 'Remplace les barres de défilement personnalisées par des barres natives dans les blocs de code et les tableaux Markdown.',
    },
    defaultValue: 'false',
  },
  {
    key: SETTINGS_KEYS.DISPLAY_COLLAPSE_LARGE_TOOL_CALLS,
    label: { en: 'Collapse large tool calls automatically', fr: 'Réduire automatiquement les grands appels d’outils' },
    description: {
      en: 'Start finished tool calls with large outputs collapsed; click to expand. Speeds up loading long sessions.',
      fr: 'Démarre les appels d’outils terminés avec les grandes sorties réduites ; cliquez pour développer. Accélère le chargement des longues sessions.',
    },
    defaultValue: 'false',
  },
  {
    key: SETTINGS_KEYS.DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING,
    label: {
      en: 'Defer code highlighting while streaming',
      fr: 'Différer la coloration syntaxique pendant le streaming',
    },
    description: {
      en: 'While a code block is streaming, wait until it closes to highlight it. Smoother streaming, but code stays plain until the end.',
      fr: 'Pendant qu’un bloc de code diffuse, attend sa fermeture pour le colorer. Streaming plus fluide, mais le code reste brut jusqu’à la fin.',
    },
    defaultValue: 'false',
  },
  {
    key: SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION,
    label: { en: 'Virtualize long feeds', fr: 'Virtualiser les longs fils' },
    description: {
      en: 'Mount only the most recent items and reveal older ones as you scroll up. Faster on very long sessions, but older history loading is experimental.',
      fr: 'Ne monte que les éléments les plus récents et révèle les plus anciens en remontant. Plus rapide sur les très longues sessions, mais le chargement de l’historique ancien est expérimental.',
    },
    defaultValue: 'false',
  },
  {
    key: SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING,
    label: { en: 'Show syntax highlighting', fr: 'Afficher la coloration syntaxique' },
    description: {
      en: 'Nicer formatting, but costly - applies to code blocks, diffs, and file previews',
      fr: 'Mise en forme plus agréable, mais coûteuse - s’applique aux blocs de code, aux diffs et aux aperçus de fichiers',
    },
    defaultValue: 'true',
  },
]

export function DisplayTab() {
  const t = useT()
  const applyLocale = useLocaleStore((state) => state.applyLocale)
  const showThinking = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_THINKING, 'true')
  const showVerboseToolOutput = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT, 'true')
  const showStats = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_STATS, 'true')
  const showAgentDefinitions = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS, 'true')
  const showWorkflowBars = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS, 'true')
  const nativeScrollbars = useSetting(SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS, 'false')
  const nativeScrollbarsCodeBlocks = useSetting(SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS, 'false')
  const collapseLargeToolCalls = useSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_LARGE_TOOL_CALLS, 'false')
  const deferCodeHighlightWhileStreaming = useSetting(
    SETTINGS_KEYS.DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING,
    'false',
  )
  const feedVirtualization = useSetting(SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION, 'false')
  const syntaxHighlighting = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING, 'true')
  const maxVisibleItems = useSetting(SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS, '300')
  const storedLocale = useSetting(SETTINGS_KEYS.DISPLAY_LOCALE, 'automatic')
  const isLoading = showThinking.loading

  const [maxItemsLocal, setMaxItemsLocal] = useState(maxVisibleItems.value)

  useEffect(() => {
    setMaxItemsLocal(maxVisibleItems.value)
  }, [maxVisibleItems.value])

  const saveMaxItems = () => {
    const num = parseInt(maxItemsLocal, 10)
    const clamped = isNaN(num) || num < 0 ? 0 : Math.min(num, 9999)
    setMaxItemsLocal(String(clamped))
    void setSetting(SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS, String(clamped))
  }

  const allToggles = [...FEED_TOGGLES, ...PERF_TOGGLES]

  const localValues: Record<string, string> = {
    [SETTINGS_KEYS.DISPLAY_SHOW_THINKING]: showThinking.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT]: showVerboseToolOutput.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_STATS]: showStats.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS]: showAgentDefinitions.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS]: showWorkflowBars.value,
    [SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS]: nativeScrollbars.value,
    [SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS]: nativeScrollbarsCodeBlocks.value,
    [SETTINGS_KEYS.DISPLAY_COLLAPSE_LARGE_TOOL_CALLS]: collapseLargeToolCalls.value,
    [SETTINGS_KEYS.DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING]: deferCodeHighlightWhileStreaming.value,
    [SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION]: feedVirtualization.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING]: syntaxHighlighting.value,
  }
  const [local, setLocal] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(allToggles.map((toggle) => [toggle.key, localValues[toggle.key] === 'true'])),
  )

  useEffect(() => {
    setLocal(Object.fromEntries(allToggles.map((toggle) => [toggle.key, localValues[toggle.key] === 'true'])))
  }, [JSON.stringify(localValues)])

  const handleToggle = (key: string) => {
    const newValue = String(!local[key as keyof typeof local])
    setLocal((prev) => ({ ...prev, [key]: !prev[key as keyof typeof local] }))
    void setSetting(key, newValue)
  }

  if (isLoading) {
    return <div className="text-sm text-text-muted">{t({ en: 'Loading...', fr: 'Chargement…' })}</div>
  }

  return (
    <div className="space-y-6">
      <ThemePicker />

      <LanguageSetting t={t} storedLocale={storedLocale.value} applyLocale={applyLocale} />

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-2">
          {t({ en: 'Custom CSS', fr: 'CSS personnalisé' })}
        </h3>
        <p className="text-xs text-text-muted mb-3">
          {t({
            en: 'Add global CSS overrides for any element.',
            fr: 'Ajoutez des surcharges CSS globales pour n’importe quel élément.',
          })}
        </p>
        <CustomCssEditor />
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-4">
          {t({ en: 'Feed Display', fr: 'Affichage du fil' })}
        </h3>
        <ToggleList toggles={FEED_TOGGLES} local={local} onToggle={handleToggle} />
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-4">
          {t({ en: 'Model Selector', fr: 'Sélecteur de modèles' })}
        </h3>
        <ModelSelectorEditor />
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-4">{t({ en: 'Performance', fr: 'Performances' })}</h3>
        <div className="space-y-4">
          <ToggleList toggles={PERF_TOGGLES} local={local} onToggle={handleToggle} />

          <label className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary font-medium">
                {t({ en: 'Max visible items', fr: 'Éléments visibles maximum' })}
              </div>
              <div className="text-xs text-text-muted mt-0.5">
                {t({
                  en: 'Keep only the last N items in the feed. Set to 0 to show all.',
                  fr: 'Conservez uniquement les N derniers éléments du fil. Mettez 0 pour tout afficher.',
                })}
              </div>
            </div>
            <input
              type="number"
              min={0}
              max={9999}
              value={maxItemsLocal}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/[^0-9]/g, '')
                setMaxItemsLocal(cleaned)
              }}
              onBlur={saveMaxItems}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveMaxItems()
              }}
              className="w-20 px-2 py-1 text-sm text-text-primary bg-bg-tertiary border border-border rounded text-right"
            />
          </label>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-2">{t({ en: 'Terminal', fr: 'Terminal' })}</h3>
        <TerminalFontEditor />
      </div>
    </div>
  )
}

const FONT_PREVIEW_TEXT = '~/project \ue0b0 git status \u2713 \u2717 \u2192 0123 iIlL1 |\u2500\u2524'

function ModelSelectorEditor() {
  const t = useT()
  const savedHeight = useSetting(SETTINGS_KEYS.DISPLAY_MODEL_SELECTOR_HEIGHT, 'default')
  const savedCollapse = useSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_PROVIDERS_BY_DEFAULT, 'false')
  const savedCollapseFavorites = useSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_FAVORITES_BY_DEFAULT, 'false')

  const handleHeightChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSetting(SETTINGS_KEYS.DISPLAY_MODEL_SELECTOR_HEIGHT, e.target.value)
  }

  const handleCollapseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_PROVIDERS_BY_DEFAULT, String(e.target.checked))
  }

  const handleCollapseFavoritesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_FAVORITES_BY_DEFAULT, String(e.target.checked))
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary font-medium">
            {t({ en: 'Dropdown size', fr: 'Taille de la liste' })}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {t({
              en: 'Choose whether the model picker uses default sizing or fills the available screen height.',
              fr: 'Choisissez si le sélecteur de modèles utilise la taille par défaut ou remplit la hauteur d’écran disponible.',
            })}
          </div>
        </div>
        <select
          value={savedHeight.value}
          onChange={handleHeightChange}
          className="px-2 py-1 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
        >
          <option value="default">{t({ en: 'Default', fr: 'Par défaut' })}</option>
          <option value="full_height">{t({ en: 'Full height', fr: 'Pleine hauteur' })}</option>
        </select>
      </label>

      <label className="flex items-start justify-between gap-3 cursor-pointer">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary font-medium">
            {t({ en: 'Collapse favorites by default', fr: 'Replier les favoris par défaut' })}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {t({
              en: 'Start with the favorites section collapsed when opening the model selector.',
              fr: 'Démarrez avec la section des favoris repliée à l’ouverture du sélecteur de modèles.',
            })}
          </div>
        </div>
        <input
          type="checkbox"
          checked={savedCollapseFavorites.value === 'true'}
          onChange={handleCollapseFavoritesChange}
          className="mt-1 h-4 w-4 rounded border-border text-accent-primary focus:ring-accent-primary"
        />
      </label>

      <label className="flex items-start justify-between gap-3 cursor-pointer">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary font-medium">
            {t({ en: 'Collapse providers by default', fr: 'Replier les fournisseurs par défaut' })}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {t({
              en: 'Start with provider lists collapsed when opening the model selector.',
              fr: 'Démarrez avec les listes de fournisseurs repliées à l’ouverture du sélecteur de modèles.',
            })}
          </div>
        </div>
        <input
          type="checkbox"
          checked={savedCollapse.value === 'true'}
          onChange={handleCollapseChange}
          className="mt-1 h-4 w-4 rounded border-border text-accent-primary focus:ring-accent-primary"
        />
      </label>
    </div>
  )
}

function ToggleList({
  toggles,
  local,
  onToggle,
}: {
  toggles: readonly ToggleDefinition[]
  local: Record<string, boolean>
  onToggle: (key: string) => void
}) {
  const t = useT()
  return (
    <div className="space-y-4">
      {toggles.map(({ key, label, description }) => (
        <label key={key} className="flex items-start justify-between gap-3 cursor-pointer">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary font-medium">{t(label)}</div>
            <div className="text-xs text-text-muted mt-0.5">{t(description)}</div>
          </div>
          <button
            type="button"
            onClick={() => onToggle(key)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              local[key] ? 'bg-accent-primary' : 'bg-bg-tertiary'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                local[key] ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </label>
      ))}
    </div>
  )
}

function LanguageSetting({
  t,
  storedLocale,
  applyLocale,
}: {
  t: (tx: Translation, vars?: Record<string, string | number>) => string
  storedLocale: string
  applyLocale: (setting: string | undefined) => void
}) {
  const options = [
    { value: 'automatic', label: t({ en: 'Automatic', fr: 'Automatique' }) },
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'Français' },
  ]

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    applyLocale(value)
    void setSetting(SETTINGS_KEYS.DISPLAY_LOCALE, value)
  }

  return (
    <div className="border-t border-border pt-4">
      <h3 className="text-sm font-medium text-text-primary mb-2">{t({ en: 'Language', fr: 'Langue' })}</h3>
      <p className="text-xs text-text-muted mb-3">
        {t({ en: 'Language of the interface.', fr: 'Langue de l’interface.' })}
      </p>
      <select
        aria-label={t({ en: 'Language', fr: 'Langue' })}
        value={storedLocale}
        onChange={handleChange}
        className="w-full px-2 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function TerminalFontEditor() {
  const t = useT()
  const savedValue = useSetting(SETTINGS_KEYS.DISPLAY_TERMINAL_FONT, DEFAULT_TERMINAL_FONT).value
  const [localValue, setLocalValue] = useState(savedValue)

  const availableFonts = useMemo(() => detectAvailableFonts(), [])
  const resolvedDefault = useMemo(() => resolveDefaultFamily(), [])

  useEffect(() => {
    setLocalValue(savedValue)
  }, [savedValue])

  // The default is a fallback stack, so its first family may not be installed:
  // show the one the browser actually resolves to instead of a phantom entry.
  const isDefaultStack = savedValue === DEFAULT_TERMINAL_FONT
  const primaryFamily = isDefaultStack ? resolvedDefault : extractPrimaryFamily(savedValue)
  const isCustom = primaryFamily !== '' && !availableFonts.includes(primaryFamily)

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const family = e.target.value
    if (!family) return
    void setSetting(SETTINGS_KEYS.DISPLAY_TERMINAL_FONT, toFontFamilyValue(family))
  }

  const saveCustom = () => {
    void setSetting(SETTINGS_KEYS.DISPLAY_TERMINAL_FONT, localValue.trim() || DEFAULT_TERMINAL_FONT)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        {t({
          en: 'Only monospace fonts detected on this machine are listed. If your shell theme uses icons or powerline glyphs, pick a Nerd Font.',
          fr: 'Seules les polices monospace détectées sur cette machine sont listées. Si votre thème de shell utilise des icônes ou des glyphes powerline, choisissez une Nerd Font.',
        })}
      </p>

      <select
        value={isCustom ? '' : primaryFamily}
        onChange={handleSelect}
        className="w-full px-2 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
      >
        {isCustom && (
          <option value="">
            {t({ en: 'Custom: {{font}}', fr: 'Personnalisée : {{font}}' }, { font: primaryFamily })}
          </option>
        )}
        {availableFonts.length === 0 && (
          <option value="">{t({ en: 'No monospace font detected', fr: 'Aucune police monospace détectée' })}</option>
        )}
        {availableFonts.map((font) => (
          <option key={font} value={font} style={{ fontFamily: `"${font}", monospace` }}>
            {font}
          </option>
        ))}
      </select>

      <ScrollArea
        horizontal
        className="px-3 py-2 text-sm text-text-primary bg-bg-tertiary border border-border rounded whitespace-nowrap"
        style={{ fontFamily: savedValue }}
      >
        {FONT_PREVIEW_TEXT}
      </ScrollArea>

      <div>
        <div className="text-xs text-text-muted mb-1">
          {t({
            en: 'Not listed? Enter a CSS font-family manually (e.g. "My Font", monospace)',
            fr: 'Pas dans la liste ? Saisissez une famille de police CSS manuellement (ex. « My Font », monospace)',
          })}
        </div>
        <input
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={saveCustom}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveCustom()
          }}
          className="w-full px-2 py-1 text-xs font-mono text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

function CustomCssEditor() {
  const t = useT()
  const savedCss = useSetting(SETTINGS_KEYS.DISPLAY_CUSTOM_CSS).value
  const [localCss, setLocalCss] = useState(savedCss)

  useEffect(() => {
    setLocalCss(savedCss)
  }, [savedCss])

  const handleSave = () => {
    void setSetting(SETTINGS_KEYS.DISPLAY_CUSTOM_CSS, localCss)
  }

  return (
    <div className="space-y-2">
      <textarea
        value={localCss}
        onChange={(e) => setLocalCss(e.target.value)}
        onBlur={handleSave}
        placeholder={t({ en: '/* Paste your custom CSS here */', fr: '/* Collez votre CSS personnalisé ici */' })}
        className="w-full h-32 px-3 py-2 text-xs font-mono text-text-primary bg-bg-tertiary border border-border rounded resize-y focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
        spellCheck={false}
      />
    </div>
  )
}
