# Output Compactor — sous-agent anti-troncature

## Problème
Les outputs massifs d'outils (web_fetch, read_file, run_command) sont tronqués à la limite de taille (100k pour web_fetch). Le contenu tronqué (~100k caractères) reste dans l'événement tool.result, ce qui consume le budget de contexte (80k tokens) du LLM local — et provoque des crashes quand l'output dépasse la fenêtre.

## Solution
Quand un tool result est `success && truncated` **et que son output dépasse 50 000 caractères**, son contenu brut est délégué à un nouveau sous-agent intégré **`output_compactor`** (contexte isolé via `subAgentId`, même modèle que l'agent principal, aucun outil — `return_value` injecté automatiquement). Le sous-agent produit un résumé minimal de **< 10 000 caractères** qui remplace le `toolResult.output` (préfixe `[COMPACTED]`, `truncated: false`) **avant** le `append` de l'événement — la DB et le contexte LLM sont nettoyés ensemble (le contexte est reconstruit depuis le store d'événements).

- Le prompt de 100k du sous-agent est marqué `subAgentId` et filtré par `buildContextMessagesFromStoredEvents` (`!data.subAgentId`) : il ne pollue ni le contexte ni le comptage de tokens de la session principale.
- Fallback silencieux : erreur ou résumé vide → l'output tronqué original est conservé, un seul `logger.warn`.
- Seuils : le déclencheur exige `success && truncated && output.length > 50000` (les outputs tronqués ≤ 50k passent sans sous-agent) ; le résumé renvoyé doit rester sous 10 000 caractères.
- Aucune régression : les outputs non tronqués (`truncated === false`) et les outputs tronqués ≤ 50k ne déclenchent rien ; `step_done`, `return_value`, `ask_user` et les erreurs d'outil sont inchangés ; `call_sub_agent` n'est pas dans le registry du compactor (TOP_LEVEL_ONLY) → pas de récession/récursion.

## Fichiers modifiés
- `src/server/chat/execute-tools.ts` — branchement `success && truncated` dans `executeTool()`, avant le calcul de `rawContent` (36 lignes)
- `src/server/agents/defaults/output-compactor.agent.md` — définition du sous-agent (`id: output_compactor`, `subagent: true`, `allowedTools: []`)

## Validation
- `tsc --noEmit` (serveur) : OK
- `eslint src/server/chat/execute-tools.ts` : OK
- Dist v2.0.149 patché de la même façon, `node --check` OK, agent résolu par `loadAllAgentsDefault` + `getSubAgents` (script de vérification)
