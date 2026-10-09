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
  DEFAULT_TERMINAL_FONT,
  MONOSPACE_FONT_CANDIDATES,
  SANS_FONT_CANDIDATES,
} from '../../../lib/fonts'
import {
  parseUiFontSize,
  UI_FONT_SIZE_DEFAULT_PX,
  UI_FONT_SIZE_MAX_PX,
  UI_FONT_SIZE_MIN_PX,
} from '../../../lib/uiFontSize'

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
    key: SETTINGS_KEYS.DISPLAY_SHOW_PROJECTS_ABOVE_SESSIONS,
    label: {
      en: 'Show projects above sessions on home page',
      fr: 'Afficher les projets au-dessus des conversations',
    },
    description: {
      en: 'Display the projects list before recent sessions on the home screen',
      fr: 'Affiche la liste des projets avant les sessions récentes sur l’écran d’accueil',
    },
    defaultValue: 'false',
  },
  {
    key: SETTINGS_KEYS.DISPLAY_SHOW_TOOL_CALL_STREAMING,
    label: {
      en: 'Show live tool call previews',
      fr: 'Afficher les aperçus d’appels d’outils en direct',
    },
    description: {
      en: 'While a model writes or edits a file, preview the content live as it streams in',
      fr: 'Pendant que le modèle écrit ou modifie un fichier, prévisualisez le contenu en direct pendant le streaming',
    },
  },
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
    key: SETTINGS_KEYS.DISPLAY_ZEN_MODE,
    label: { en: 'Zen mode', fr: 'Mode zen' },
    description: {
      en: 'Hide finished tool calls in the feed; running calls and anything waiting for your input stay visible. The composer toolbar has a quick toggle.',
      fr: 'Masque les appels d’outils terminés dans le fil ; les appels en cours et tout ce qui attend votre saisie restent visibles. La barre d’outils du composeur a une bascule rapide.',
    },
    defaultValue: 'false',
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
  {
    key: SETTINGS_KEYS.DISPLAY_FULLSCREEN_SLASH_COMMAND,
    label: { en: 'Fullscreen slash commands view', fr: 'Vue plein écran des commandes slash' },
    description: {
      en: 'Choose whether the commands view uses default sizing or fills the available screen height.',
      fr: 'Choisissez si la vue des commandes utilise la taille par défaut ou remplit la hauteur d’écran disponible.',
    },
    defaultValue: 'false',
  },
]

const PERF_TOGGLES: ToggleDefinition[] = [
  {
    key: SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS,
    label: {
      en: 'Use native scrollbars',
      fr: 'Utiliser les barres de défilement natives',
    },
    description: {
      en: 'Swap custom styled scrollbars for native ones across scrollable views (chat feed, tool calls, sub-agent runs, modals). Faster, but native scrollbars look different on some platforms.',
      fr: 'Remplace les barres de défilement personnalisées par des barres natives dans toutes les vues défilantes (fil de discussion, appels d’outils, exécutions de sous-agents, fenêtres modales). Plus rapide, mais l’apparence diffère selon les plateformes.',
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
      en: 'Show only the most recent items and load older ones as you scroll up. Keeps long sessions fast — the most recent messages are always retained.',
      fr: 'N’affiche que les éléments les plus récents et charge les plus anciens en remontant. Garde les longues sessions fluides — les messages les plus récents sont toujours conservés.',
    },
    defaultValue: 'true',
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

const COMPOSER_TOGGLES: ToggleDefinition[] = [
  {
    key: SETTINGS_KEYS.DISPLAY_MOBILE_FULLSCREEN_COMPOSER,
    label: {
      en: 'Expand composer full-screen on mobile',
      fr: 'Agrandir la zone de saisie en plein écran sur mobile',
    },
    description: {
      en: 'When the keyboard is open on a touch device, fill the screen with the textarea so you can focus on writing. Off by default: the textarea grows with its content and you keep seeing the conversation.',
      fr: 'Lorsque le clavier est ouvert sur un appareil tactile, remplir l’écran avec la zone de saisie pour rester concentré sur la rédaction. Désactivé par défaut : la zone grandit avec son contenu et la conversation reste visible.',
    },
    defaultValue: 'false',
  },
]

export function DisplayTab() {
  const t = useT()
  const applyLocale = useLocaleStore((state) => state.applyLocale)
  const showThinking = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_THINKING, 'true')
  const showVerboseToolOutput = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT, 'true')
  const zenMode = useSetting(SETTINGS_KEYS.DISPLAY_ZEN_MODE, 'false')
  const showStats = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_STATS, 'true')
  const showAgentDefinitions = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS, 'true')
  const showWorkflowBars = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS, 'true')
  const showProjectsAboveSessions = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_PROJECTS_ABOVE_SESSIONS, 'false')
  const showToolCallStreaming = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_TOOL_CALL_STREAMING, 'false')
  const fullscreenSlashCommand = useSetting(SETTINGS_KEYS.DISPLAY_FULLSCREEN_SLASH_COMMAND, 'false')
  const nativeScrollbars = useSetting(SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS, 'false')
  const nativeScrollbarsCodeBlocks = useSetting(SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS, 'false')
  const collapseLargeToolCalls = useSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_LARGE_TOOL_CALLS, 'false')
  const deferCodeHighlightWhileStreaming = useSetting(
    SETTINGS_KEYS.DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING,
    'false',
  )
  const feedVirtualization = useSetting(SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION, 'true')
  const syntaxHighlighting = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING, 'true')
  const maxVisibleItems = useSetting(SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS, '300')
  const storedLocale = useSetting(SETTINGS_KEYS.DISPLAY_LOCALE, 'automatic')
  const fullscreenComposer = useSetting(SETTINGS_KEYS.DISPLAY_MOBILE_FULLSCREEN_COMPOSER, 'false')
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

  const allToggles = [...FEED_TOGGLES, ...PERF_TOGGLES, ...COMPOSER_TOGGLES]

  const localValues: Record<string, string> = {
    [SETTINGS_KEYS.DISPLAY_SHOW_PROJECTS_ABOVE_SESSIONS]: showProjectsAboveSessions.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_TOOL_CALL_STREAMING]: showToolCallStreaming.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_THINKING]: showThinking.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT]: showVerboseToolOutput.value,
    [SETTINGS_KEYS.DISPLAY_ZEN_MODE]: zenMode.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_STATS]: showStats.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS]: showAgentDefinitions.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS]: showWorkflowBars.value,
    [SETTINGS_KEYS.DISPLAY_FULLSCREEN_SLASH_COMMAND]: fullscreenSlashCommand.value,
    [SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS]: nativeScrollbars.value,
    [SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS]: nativeScrollbarsCodeBlocks.value,
    [SETTINGS_KEYS.DISPLAY_COLLAPSE_LARGE_TOOL_CALLS]: collapseLargeToolCalls.value,
    [SETTINGS_KEYS.DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING]: deferCodeHighlightWhileStreaming.value,
    [SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION]: feedVirtualization.value,
    [SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING]: syntaxHighlighting.value,
    [SETTINGS_KEYS.DISPLAY_MOBILE_FULLSCREEN_COMPOSER]: fullscreenComposer.value,
  }

  const [local, setLocal] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      allToggles.map((toggle) => [toggle.key, (localValues[toggle.key] ?? toggle.defaultValue) === 'true']),
    ),
  )

  useEffect(() => {
    setLocal(
      Object.fromEntries(
        allToggles.map((toggle) => [toggle.key, (localValues[toggle.key] ?? toggle.defaultValue) === 'true']),
      ),
    )
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
        <h3 className="text-sm font-medium text-text-primary mb-4">{t({ en: 'Composer', fr: 'Zone de saisie' })}</h3>
        <ToggleList toggles={COMPOSER_TOGGLES} local={local} onToggle={handleToggle} />
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-4">
          {t({ en: 'Danger Level Selector', fr: 'Sélecteur de niveau de danger' })}
        </h3>
        <DangerLevelDisplaySettings />
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
        <h3 className="text-sm font-medium text-text-primary mb-4">{t({ en: 'Fonts', fr: 'Polices' })}</h3>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-text-primary">{t({ en: 'Font size', fr: 'Taille de la police' })}</h4>
          <FontSizeEditor />
        </div>

        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium text-text-primary">
            {t({ en: 'Interface font', fr: 'Police d’interface' })}
          </h4>
          <UiFontEditor />
        </div>

        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium text-text-primary">
            {t({ en: 'Terminal font', fr: 'Police du terminal' })}
          </h4>
          <TerminalFontEditor />
        </div>
      </div>
    </div>
  )
}

const FONT_PREVIEW_TEXT = '~/project \ue0b0 git status \u2713 \u2717 \u2192 0123 iIlL1 |\u2500\u2524'

const UI_FONT_PREVIEW_TEXT = 'Interface AaBbCcDdEe 0123456789 — Éàçöü·¿¡ 设置字体'

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

function DangerLevelDisplaySettings() {
  const t = useT()
  const displayMode = useSetting(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_DISPLAY_MODE, 'default')
  const autoList = useSetting(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_AUTO_LIST, 'false')
  const autoListThreshold = useSetting(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_AUTO_LIST_THRESHOLD, '3')
  const [localThreshold, setLocalThreshold] = useState(autoListThreshold.value || '3')

  useEffect(() => {
    setLocalThreshold(autoListThreshold.value || '3')
  }, [autoListThreshold.value])

  const handleModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    void setSetting(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_DISPLAY_MODE, e.target.value)
  }

  const handleAutoListChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void setSetting(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_AUTO_LIST, String(e.target.checked))
  }

  const handleThresholdBlur = () => {
    const parsed = parseInt(localThreshold, 10)
    const clamped = isNaN(parsed) || parsed < 1 ? 3 : parsed
    setLocalThreshold(String(clamped))
    void setSetting(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_AUTO_LIST_THRESHOLD, String(clamped))
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary font-medium">
            {t({ en: 'Display style', fr: 'Style d’affichage' })}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {t({
              en: 'Choose between segmented buttons (default) or a compact dropdown list under the chat composer.',
              fr: 'Choisissez entre des boutons segmentés (par défaut) ou une liste déroulante compacte sous le chat.',
            })}
          </div>
        </div>
        <select
          value={displayMode.value || 'default'}
          onChange={handleModeChange}
          className="px-2 py-1 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
        >
          <option value="default">{t({ en: 'Default (Buttons)', fr: 'Boutons (Défaut)' })}</option>
          <option value="list">{t({ en: 'Dropdown List', fr: 'Liste déroulante' })}</option>
        </select>
      </label>

      <label className="flex items-start justify-between gap-3 cursor-pointer">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary font-medium">
            {t({
              en: 'Auto-switch to list if more than threshold',
              fr: 'Basculer automatiquement en liste au-delà d’un seuil',
            })}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {t({
              en: 'Automatically render as a dropdown list when the number of available danger levels exceeds the threshold.',
              fr: 'Affiche automatiquement une liste déroulante lorsque le nombre de niveaux de danger disponibles dépasse le seuil.',
            })}
          </div>
        </div>
        <input
          type="checkbox"
          checked={autoList.value === 'true'}
          onChange={handleAutoListChange}
          className="mt-1 h-4 w-4 rounded border-border text-accent-primary focus:ring-accent-primary"
        />
      </label>

      {autoList.value === 'true' && (
        <label className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary font-medium">
              {t({ en: 'Auto-switch threshold', fr: 'Seuil de bascule automatique' })}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              {t({
                en: 'Maximum number of danger levels before automatically switching to dropdown list (default: 3).',
                fr: 'Nombre maximum de niveaux de danger avant de passer automatiquement en liste déroulante (défaut : 3).',
              })}
            </div>
          </div>
          <input
            type="number"
            min="1"
            max="20"
            value={localThreshold}
            onChange={(e) => setLocalThreshold(e.target.value)}
            onBlur={handleThresholdBlur}
            className="w-20 px-2 py-1 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary text-center font-mono"
          />
        </label>
      )}
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
            role="button"
            aria-pressed={local[key] ? 'true' : 'false'}
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

// Sentinel option values for the special (non-font) entries in the select.
const DEFAULT_FONT_SENTINEL = '__default_font__'
const CUSTOM_FONT_SENTINEL = '__custom_font__'

interface FontFamilyEditorProps {
  settingKey: string
  // Value saved when the Default option is chosen (and the useSetting fallback):
  // '' for the UI font (no override → :root monospace), the full monospace stack
  // for the terminal.
  defaultSaveValue: string
  // Font families offered in the list (detected client-side).
  candidates: readonly string[]
  // Generic fallback appended when a single family is picked from the list.
  fallback: 'monospace' | 'sans-serif'
  // When provided, adds an explicit "Default" option restoring defaultSaveValue
  // with one click.
  defaultOptionLabel?: Translation
  // When true, the preview inherits the surrounding font instead of pinning an
  // explicit family. Used by the UI font so its preview always mirrors the actual
  // UI font (default or custom) without duplicating the monospace stack.
  previewInherits?: boolean
  description: Translation
  noDetectedLabel?: Translation
  customHintLabel: Translation
  previewText: string
}

function FontFamilyEditor({
  settingKey,
  defaultSaveValue,
  candidates,
  fallback,
  defaultOptionLabel,
  previewInherits,
  description,
  noDetectedLabel,
  customHintLabel,
  previewText,
}: FontFamilyEditorProps) {
  const t = useT()
  const savedValue = useSetting(settingKey, defaultSaveValue).value
  const [localValue, setLocalValue] = useState(savedValue)

  const availableFonts = useMemo(() => detectAvailableFonts([...candidates]), [candidates])

  useEffect(() => {
    setLocalValue(savedValue)
  }, [savedValue])

  const isDefault = savedValue.trim() === defaultSaveValue.trim()
  const primaryFamily = isDefault ? '' : extractPrimaryFamily(savedValue)
  const isCustom = !isDefault && primaryFamily !== '' && !availableFonts.includes(primaryFamily)

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    if (value === DEFAULT_FONT_SENTINEL) {
      void setSetting(settingKey, defaultSaveValue)
      return
    }
    if (value === CUSTOM_FONT_SENTINEL) return
    void setSetting(settingKey, toFontFamilyValue(value, fallback))
  }

  const saveCustom = () => {
    const trimmed = localValue.trim()
    void setSetting(settingKey, trimmed === '' ? defaultSaveValue : trimmed)
  }

  const selectValue = isDefault ? DEFAULT_FONT_SENTINEL : isCustom ? CUSTOM_FONT_SENTINEL : primaryFamily

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">{t(description)}</p>

      <select
        value={selectValue}
        onChange={handleSelect}
        className="w-full px-2 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
      >
        {defaultOptionLabel && <option value={DEFAULT_FONT_SENTINEL}>{t(defaultOptionLabel)}</option>}
        {isCustom && (
          <option value={CUSTOM_FONT_SENTINEL}>
            {t({ en: 'Custom: {{font}}', fr: 'Personnalisée : {{font}}' }, { font: primaryFamily })}
          </option>
        )}
        {availableFonts.length === 0 && noDetectedLabel && <option value="">{t(noDetectedLabel)}</option>}
        {availableFonts.map((font) => (
          <option key={font} value={font} style={{ fontFamily: `"${font}", ${fallback}` }}>
            {font}
          </option>
        ))}
      </select>

      <ScrollArea
        horizontal
        className="px-3 py-2 text-sm text-text-primary bg-bg-tertiary border border-border rounded whitespace-nowrap"
        style={previewInherits ? undefined : { fontFamily: savedValue }}
      >
        {previewText}
      </ScrollArea>

      <div>
        <div className="text-xs text-text-muted mb-1">{t(customHintLabel)}</div>
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

function UiFontEditor() {
  return (
    <FontFamilyEditor
      settingKey={SETTINGS_KEYS.DISPLAY_UI_FONT}
      defaultSaveValue=""
      candidates={SANS_FONT_CANDIDATES}
      fallback="sans-serif"
      defaultOptionLabel={{ en: 'Default (monospace)', fr: 'Par défaut (monospace)' }}
      previewInherits
      description={{
        en: 'Font used across the whole interface. Code blocks, diffs, logs and the terminal always stay monospace.',
        fr: 'Police utilisée sur toute l’interface. Les blocs de code, les diffs, les journaux et le terminal restent toujours en police monospace.',
      }}
      customHintLabel={{
        en: 'Not listed? Enter a CSS font-family manually (e.g. "My Font", sans-serif)',
        fr: 'Pas dans la liste ? Saisissez une famille de police CSS manuellement (ex. « My Font », sans-serif)',
      }}
      previewText={UI_FONT_PREVIEW_TEXT}
    />
  )
}

function FontSizeEditor() {
  const t = useT()
  const saved = useSetting(SETTINGS_KEYS.DISPLAY_UI_FONT_SIZE, '').value
  const savedPx = parseUiFontSize(saved) ?? UI_FONT_SIZE_DEFAULT_PX
  const clampedSavedPx = Math.min(UI_FONT_SIZE_MAX_PX, Math.max(UI_FONT_SIZE_MIN_PX, savedPx))
  const [localPx, setLocalPx] = useState(clampedSavedPx)

  useEffect(() => {
    setLocalPx(clampedSavedPx)
  }, [clampedSavedPx])

  const commit = () => {
    void setSetting(SETTINGS_KEYS.DISPLAY_UI_FONT_SIZE, localPx === UI_FONT_SIZE_DEFAULT_PX ? '' : String(localPx))
  }

  const resetToDefault = () => {
    setLocalPx(UI_FONT_SIZE_DEFAULT_PX)
    void setSetting(SETTINGS_KEYS.DISPLAY_UI_FONT_SIZE, '')
  }

  const pct = Number(((localPx / UI_FONT_SIZE_DEFAULT_PX) * 100).toFixed(2))

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        {t({
          en: 'Scales the whole interface — text, code blocks, diffs and terminal. 100% is the default.',
          fr: 'Met à l’échelle toute l’interface — texte, blocs de code, diffs et terminal. 100 % est la valeur par défaut.',
        })}
      </p>

      <div className="flex items-center gap-3">
        <input
          type="range"
          min={UI_FONT_SIZE_MIN_PX}
          max={UI_FONT_SIZE_MAX_PX}
          step={1}
          value={localPx}
          onChange={(e) => setLocalPx(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          aria-label={t({ en: 'Font size', fr: 'Taille de la police' })}
          aria-valuetext={t({ en: '{{pct}}%', fr: '{{pct}} %' }, { pct })}
          className="flex-1 accent-accent-primary"
        />
        <span className="w-16 text-right text-sm text-text-primary">
          {t({ en: '{{pct}}%', fr: '{{pct}} %' }, { pct })}
        </span>
      </div>

      <button
        type="button"
        onClick={resetToDefault}
        className="px-2 py-1 text-xs text-text-primary bg-bg-tertiary border border-border rounded hover:border-accent-primary/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
      >
        {t({ en: 'Default', fr: 'Par défaut' })}
      </button>

      <ScrollArea
        horizontal
        className="px-3 py-2 text-sm text-text-primary bg-bg-tertiary border border-border rounded whitespace-nowrap"
        style={{ fontSize: `${localPx}px` }}
      >
        {UI_FONT_PREVIEW_TEXT}
      </ScrollArea>
    </div>
  )
}

function TerminalFontEditor() {
  return (
    <FontFamilyEditor
      settingKey={SETTINGS_KEYS.DISPLAY_TERMINAL_FONT}
      defaultSaveValue={DEFAULT_TERMINAL_FONT}
      candidates={MONOSPACE_FONT_CANDIDATES}
      fallback="monospace"
      defaultOptionLabel={{ en: 'Default (monospace)', fr: 'Par défaut (monospace)' }}
      description={{
        en: 'Only monospace fonts detected on this machine are listed. If your shell theme uses icons or powerline glyphs, pick a Nerd Font.',
        fr: 'Seules les polices monospace détectées sur cette machine sont listées. Si votre thème de shell utilise des icônes ou des glyphes powerline, choisissez une Nerd Font.',
      }}
      noDetectedLabel={{ en: 'No monospace font detected', fr: 'Aucune police monospace détectée' }}
      customHintLabel={{
        en: 'Not listed? Enter a CSS font-family manually (e.g. "My Font", monospace)',
        fr: 'Pas dans la liste ? Saisissez une famille de police CSS manuellement (ex. « My Font », monospace)',
      }}
      previewText={FONT_PREVIEW_TEXT}
    />
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
