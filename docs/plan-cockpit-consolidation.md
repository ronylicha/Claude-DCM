# Plan: Consolidation des pages Live/Waves/Flows dans le Cockpit

> Date: 2026-03-28
> Statut: A implementer (prochaine session)
> Priorite: Haute

## Objectif

Fusionner les features utiles de Live, Waves et Flows directement dans le cockpit.
Supprimer les pages devenues redondantes. Zero dette technique.

## Analyse des pages existantes

### /live — Ce qu'elle offre
- Event stream temps reel (WebSocket)
- Topology grid des agents actifs (couleur par type)
- Gauges semi-circulaires (sessions, agents, tasks, actions/min)
- Connection status bar WebSocket
- **A garder** : event stream, agent topology grid
- **Deja dans cockpit** : sessions actives, agents count

### /waves — Ce qu'elle offre
- Selecteur de session
- Wave pipeline avec progression par wave
- Detail des subtasks par wave
- Agent assignments
- **A garder** : wave pipeline + detail (integrer dans CockpitZoom)
- **Deja dans cockpit** : selecteur session = mini-cockpits

### /flows — Ce qu'elle offre
- Topology SVG inter-sessions (noeuds + aretes)
- KPIs (sessions, agents, actions)
- Event feed recent
- **A garder** : rien — remplace par OrchestratorTopology3D
- **Deja dans cockpit** : tout (topology 3D + KPIs + status bar)

## Plan d'implementation

### Phase 1 — Enrichir CockpitZoom avec Waves
- Ajouter le wave pipeline complet dans la Zone 3 de CockpitZoom
- Ajouter le detail des subtasks par wave (waterfall)
- Source : extraire la logique de waves/page.tsx

### Phase 2 — Ajouter Event Stream au Cockpit
- Ajouter un onglet/section "Live" dans le cockpit (toggle)
- Event feed temps reel (dernieres 20 actions)
- Agent topology grid (mini version)
- Source : extraire de live/page.tsx

### Phase 3 — Supprimer les pages redondantes
- Supprimer `/flows/page.tsx` (remplace par topologie 3D)
- Simplifier `/live/page.tsx` en redirect vers cockpit
- Simplifier `/waves/page.tsx` en redirect vers cockpit
- Supprimer les composants orphelins

### Phase 4 — Mettre a jour NavigationRail
- Retirer Flows du menu (ou redirect)
- Retirer Live du menu (ou redirect)
- Retirer Waves du menu (ou redirect)
- Garder uniquement : Cockpit, Projects, Sessions, Agents, Context, Compact, Tools, Routing, Messages, Registry, Perf

### Phase 5 — Cleanup
- Supprimer les composants dashboard obsoletes (HealthGauge, PremiumKPICard, SystemPulseBar)
- Supprimer les hooks inutilises
- Verifier que tous les imports sont propres
- Build final + tests

## Fichiers impactes
- context-dashboard/src/app/cockpit/page.tsx (enrichir)
- context-dashboard/src/components/cockpit/CockpitZoom.tsx (enrichir)
- context-dashboard/src/app/flows/page.tsx (supprimer ou redirect)
- context-dashboard/src/app/live/page.tsx (simplifier ou redirect)
- context-dashboard/src/app/waves/page.tsx (simplifier ou redirect)
- context-dashboard/src/components/layout/NavigationRail.tsx (simplifier)
- context-dashboard/src/components/dashboard/* (cleanup)

## Commande pour lancer
```
/orchestrate -p "Consolider live+waves+flows dans le cockpit, supprimer les pages redondantes"
```
