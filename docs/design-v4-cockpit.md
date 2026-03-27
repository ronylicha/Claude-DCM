# DCM v4 — Design: Cockpit Multi-Session, Tokens Reels & M3

> Date: 2026-03-27
> Statut: Valide (brainstorming complet)
> Auteur: Rony + Claude (brainstorming structure)

---

## 1. Vision

DCM passe d'**observateur passif** a **controleur actif du contexte**. Les axes :

1. **Tokens reels en temps reel** via le statusline Claude Code
2. **Cockpit mission control multi-monitor** — toutes les sessions simultanees
3. **Barre de statut persistante** — agrege global + pastilles par session
4. **Timeline chronologique** — arbre agents + activite temporelle
5. **Waves pipeline + waterfall** — Kanban flux + detail empile
6. **Jauge + notifications + prediction + recommandations** — alertes multi-niveaux
7. **Compaction pre-emptive a 85%** — resume complet genere AVANT la compaction
8. **Agent headless de summarization** — `claude -p --bare` recoit le contexte brut de la BDD
9. **Contextes differencies par agent** — Opus 1M / Sonnet 200K / Haiku 200K
10. **Refonte UI Material Design 3** — light + dark, toute l'application

---

## 2. Contraintes

- Stack existante : Bun + Hono + PostgreSQL + Next.js 16
- Hooks Claude Code comme point d'entree des donnees
- WebSocket deja en place pour le temps reel
- Schema DB existant a etendre, pas remplacer
- Multi-session : plusieurs sessions Claude independantes en parallele

---

## 3. Decisions Techniques Verifiees

### Tokens reels
- Les hooks PostToolUse **ne contiennent PAS** les tokens
- Le **statusline** fournit : `total_input_tokens`, `total_output_tokens`, `context_window_size`, `used_percentage`, `remaining_percentage`
- Le statusline est la **seule source de verite** pour les tokens reels

### Agent headless
- `claude -p "prompt" --bare --allowedTools "" --output-format text` fonctionne
- Contexte injectable via `--append-system-prompt-file`
- Pas de flag `--model` direct, le modele vient de la config

### Compaction
- `/compact` **n'est pas declenchable programmatiquement**
- Les hooks PreCompact/PostCompact sont en **lecture seule**
- Strategie choisie : **pre-emptive** — generer le resume a 85%, pret quand la compaction arrive naturellement

---

## 4. Architecture Tokens Reels

### Pipeline Statusline → DCM → Dashboard

```
Session Claude A → statusline-dcm.sh → POST /api/tokens/realtime { session_id: "A", ... }
Session Claude B → statusline-dcm.sh → POST /api/tokens/realtime { session_id: "B", ... }
Session Claude C → statusline-dcm.sh → POST /api/tokens/realtime { session_id: "C", ... }
                                              │
                                              ▼
                                      DCM API (tokens-realtime.ts)
                                              │
                                  ┌───────────┼────────────┐
                                  ▼           ▼            ▼
                          agent_capacity  calibration  WebSocket broadcast
                          (upsert)       _ratios      "capacity.update"
                                                           │
                                                           ▼
                                                    Dashboard (toutes pages)
```

### Payload `POST /api/tokens/realtime`

```typescript
interface RealtimeTokenPayload {
  session_id: string;
  agent_id?: string;              // defaut = orchestrateur
  total_input_tokens: number;
  total_output_tokens: number;
  context_window_size: number;    // 1M, 200K selon modele
  used_percentage: number;
  model_id: string;
}
```

### Logique serveur

1. Upsert `agent_capacity` avec `source = 'statusline'`
2. Calcule delta depuis dernier appel → maj `consumption_rate` (EMA 0.3/0.7)
3. Recalcule zone (green/yellow/orange/red/critical)
4. Recalcule `predicted_exhaustion_minutes`
5. Calcule `calibration_ratio = real / estimated`
6. Si `used_percentage >= 85` ET pas de resume `generating` → trigger summarization
7. WebSocket broadcast `capacity.update`
8. Si franchissement de seuil → WebSocket `capacity.threshold`

### Calibration sub-agents

```
ratio = real_tokens (statusline orchestrateur) / estimated_tokens (hooks)
→ Applique ce ratio aux sub-agents qui n'ont pas de statusline
→ Recalcule toutes les 30s
→ Stocke dans calibration_ratios(session_id, ratio, calculated_at)
```

### Contextes differencies par modele

| Modele | context_window (max_capacity) | Usage |
|--------|-------------------------------|-------|
| Opus 4.6 | 1,000,000 | Orchestrateur principal |
| Sonnet 4.6 | 200,000 | Agents d'implementation |
| Haiku 4.5 | 200,000 | Agents de recherche/exploration |

Pas de nouvelle colonne — `max_capacity` existant dans `agent_capacity` est mis a jour dynamiquement selon le modele.

---

## 5. Compaction Pre-emptive

### Declenchement

```
agent_capacity.used_percentage >= 85%
  + cooldown 2 min (pas de re-declenchement)
  + pas de resume deja en statut 'generating'
  → lance le pipeline de summarization
```

### Collecte du contexte brut

`GET /api/compact/raw-context/:sid` assemble un Markdown structure depuis la BDD :

```markdown
# Contexte Session {session_id}

## Taches Actives
- [running] backend-laravel-1: "Creer le UserController" (wave 2)
- [blocked] qa-testing-1: "Tests UserController" (bloque par backend-laravel-1)

## Decisions Cles
- Architecture REST, pas GraphQL (wave 0)
- Sanctum pour l'auth API (wave 1)

## Fichiers Modifies
- app/Http/Controllers/UserController.php (cree, wave 2)
- database/migrations/2026_03_27_create_users_table.php (complete, wave 1)

## Historique des Waves
- Wave 0: Legal + API contracts done
- Wave 1: Migrations + Models done
- Wave 2: Controllers + Frontend (en cours, 3/5 taches)

## Messages Inter-Agents Recents
- backend-1 → frontend-1: "API users prete, schema: {id, name, email}"

## Etat des Agents
| Agent | Type | Status | Tokens | Wave |
|-------|------|--------|--------|------|
| orchestrateur | opus | running | 850K/1M | - |
| backend-1 | sonnet | running | 120K/200K | 2 |
```

Limite : ~50K caracteres max (~14K tokens).

### Script headless

```bash
#!/bin/bash
# scripts/preemptive-summarize.sh

CONTEXT_FILE="/tmp/dcm-context-${SESSION_ID}.md"
SUMMARY_FILE="/tmp/dcm-summary-${SESSION_ID}.md"

# 1. Collecte contexte brut
curl -s "http://127.0.0.1:3847/api/compact/raw-context/${SESSION_ID}" > "$CONTEXT_FILE"

# 2. Lance claude en mode headless
claude -p "Tu es un expert en resume de contexte de session de developpement.
Resume ce contexte en preservant :
- Toutes les taches actives et leur statut exact
- Toutes les decisions architecturales
- Tous les fichiers modifies avec leur etat
- Les dependances entre agents
- Les informations critiques pour reprendre le travail sans perte

Sois exhaustif sur les FAITS, concis sur les DESCRIPTIONS.
Ne perds AUCUNE information actionnable." \
  --bare \
  --allowedTools "" \
  --output-format text \
  --append-system-prompt-file "$CONTEXT_FILE" \
  > "$SUMMARY_FILE"

# 3. Pousse le resume dans DCM
curl -s -X POST "http://127.0.0.1:3847/api/compact/preemptive-summary" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"${SESSION_ID}\",
    \"summary\": $(jq -Rs . < "$SUMMARY_FILE"),
    \"source\": \"headless-agent\",
    \"context_tokens_at_trigger\": ${TOKENS_USED}
  }"

# 4. Cleanup
rm -f "$CONTEXT_FILE" "$SUMMARY_FILE"
```

### Integration PostCompact

```
Compaction naturelle arrive
  → PostCompact hook (post-compact-restore.sh)
  → Cherche resume pre-emptif "ready" pour cette session
  → Si trouve : utilise ce resume (plus riche que le snapshot standard)
  → Marque comme "consumed"
  → Si pas trouve : fallback sur le snapshot standard existant
```

### Multi-session : resumes paralleles

Chaque session a son propre process headless, lances en parallele sans limite.

---

## 6. Schema DB

### Modifications sur tables existantes

```sql
-- Extension agent_capacity
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS
  real_input_tokens BIGINT DEFAULT 0,
  real_output_tokens BIGINT DEFAULT 0,
  model_id TEXT,
  source TEXT DEFAULT 'estimated',
  last_statusline_at TIMESTAMPTZ;
```

### Nouvelles tables

```sql
CREATE TABLE preemptive_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  agent_id TEXT,
  summary TEXT NOT NULL,
  source TEXT DEFAULT 'headless-agent',
  context_tokens_at_trigger BIGINT,
  status TEXT DEFAULT 'ready',  -- 'generating' | 'ready' | 'consumed'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX idx_preemptive_session_status
  ON preemptive_summaries(session_id, status);

CREATE TABLE calibration_ratios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  ratio FLOAT NOT NULL DEFAULT 1.0,
  real_tokens BIGINT NOT NULL,
  estimated_tokens BIGINT NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calibration_session
  ON calibration_ratios(session_id, calculated_at DESC);
```

---

## 7. Endpoints API

### Nouveaux

| Methode | Route | Description |
|---------|-------|-------------|
| POST | `/api/tokens/realtime` | Statusline pousse les tokens reels |
| GET | `/api/tokens/projection/:sid` | Projection 5h/7j |
| GET | `/api/tokens/calibration/:sid` | Ratio reel/estime |
| GET | `/api/compact/raw-context/:sid` | Contexte brut Markdown |
| POST | `/api/compact/preemptive-summary` | Stocke resume headless |
| GET | `/api/compact/preemptive/:sid` | Dernier resume pret |
| GET | `/api/sessions/active` | Sessions actives avec capacite |
| GET | `/api/cockpit/global` | Agrege toutes sessions (StatusBar) |
| GET | `/api/cockpit/grid` | Donnees mini-cockpits |
| GET | `/api/cockpit/:sid` | Cockpit zoome 1 session |
| GET | `/api/cockpit/timeline/:sid` | Timeline agents x temps |
| GET | `/api/agents/tree/:pid` | Arbre hierarchique |
| GET | `/api/agents/contexts/:sid` | Agents + jauge individuelle |

### Responses types

```typescript
interface GlobalCockpitResponse {
  sessions: {
    total_active: number;
    by_model: { opus: number; sonnet: number; haiku: number };
  };
  agents: {
    total: number;
    running: number;
    blocked: number;
    completed: number;
  };
  tokens: {
    total_consumed: number;
    total_rate: number;
    by_session: {
      session_id: string;
      project_name: string;
      model_id: string;
      used_percentage: number;
      zone: string;
      predicted_exhaustion_minutes: number;
      agents_count: number;
      current_wave: number;
    }[];
  };
  summaries: {
    generating: number;
    ready: number;
  };
}

interface MiniCockpitData {
  session_id: string;
  project_name: string;
  project_path: string;
  model_id: string;
  started_at: string;
  context: {
    used_percentage: number;
    current_usage: number;
    context_window_size: number;
    zone: string;
    consumption_rate: number;
    predicted_exhaustion_minutes: number;
    source: 'statusline' | 'estimated';
  };
  wave: {
    current_number: number;
    label: string;
    completed: number;
    total: number;
    status: string;
  };
  agents: {
    total: number;
    running: number;
    blocked: number;
    last_action?: {
      agent_id: string;
      tool_name: string;
      file_path?: string;
      timestamp: string;
    };
  };
  sparkline: number[];
  preemptive_summary: {
    status: 'none' | 'generating' | 'ready';
  };
}

interface CockpitResponse {
  context: {
    current_usage: number;
    context_window_size: number;
    used_percentage: number;
    zone: string;
    consumption_rate: number;
    predicted_exhaustion_minutes: number;
    projection_5h: ContextProjection;
    projection_7d: ContextProjection;
    source: 'statusline' | 'estimated';
    preemptive_summary: {
      status: 'none' | 'generating' | 'ready';
      created_at?: string;
    };
  };
  agents: {
    tree: AgentNode[];
    summary: { total: number; running: number; blocked: number; completed: number; failed: number };
    contexts: AgentContext[];
  };
  waves: {
    current: WaveState;
    pipeline: WaveState[];
    current_detail: SubtaskProgress[];
  };
  timeline: {
    agents: TimelineAgent[];
    wave_boundaries: WaveBoundary[];
    markers: TimelineMarker[];
  };
}
```

### WebSocket — Nouveaux evenements

```
"capacity.update"     → toutes les 2-5s, donnees agent_capacity par session
"capacity.threshold"  → franchissement de seuil (50, 70, 85, 95)
"summary.status"      → progression du resume pre-emptif
"cockpit.refresh"     → signal de rafraichissement (wave_transition, agent_spawn, etc.)
```

---

## 8. Design UI — Material Design 3

### Palette custom DCM

Source color : `#0077B6` (bleu profond tech)

| Role | Light | Dark |
|------|-------|------|
| Primary | `#006494` | `#8ECAE6` |
| On Primary | `#FFFFFF` | `#003549` |
| Primary Container | `#C8E6FF` | `#004B6F` |
| Secondary | `#4E616D` | `#B6CBD8` |
| Tertiary | `#5E5B7E` | `#C7C2EA` |
| Error | `#BA1A1A` | `#FFB4AB` |
| Surface | `#F7FAFE` | `#0E1415` |
| On Surface | `#181C1F` | `#DEE3E7` |
| Surface Container | `#ECF0F4` | `#1E2529` |
| Surface Container High | `#E0E5E9` | `#293035` |
| Outline | `#70787E` | `#8A9299` |

### Zones de contexte

| Zone | Light | Dark | Seuil |
|------|-------|------|-------|
| Green | `#1B873B` | `#6DD58C` | 0-50% |
| Yellow | `#9A7B00` | `#E4C442` | 50-70% |
| Orange | `#B65C00` | `#FFB868` | 70-85% |
| Red | `#BA1A1A` | `#FFB4AB` | 85-95% |
| Critical | `#8C0009` | `#FF5449` | 95%+ |

### Couleurs agent types

| Agent Type | Light | Dark |
|------------|-------|------|
| Orchestrateur (opus) | `#6750A4` | `#D0BCFF` |
| Backend Laravel | `#B65C00` | `#FFB868` |
| Frontend React | `#006494` | `#8ECAE6` |
| Database | `#5E5B7E` | `#C7C2EA` |
| QA/Testing | `#1B873B` | `#6DD58C` |
| Security | `#BA1A1A` | `#FFB4AB` |
| DevOps | `#4E616D` | `#B6CBD8` |

### Layout principal

```
Navigation Rail M3 (72px, expand on hover → 360px Drawer)
  + Top App Bar M3 medium (64px)
  + Page Content (scroll)
  + StatusBar fixe (56px bottom)
```

### StatusBar multi-session

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3 sessions │ 8 agents │ 1.2M tok total │ ●A 42% ●B 71% ●C 23% │ Cockpit → │
│ 2 Opus 1 Son│ 5🟢 2🟡 1⬜│ 18K tok/min    │ 🟢    🟡     🟢     │           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Cockpit multi-monitor

Grid de mini-cockpits (1 par session active), clic "Zoom" pour agrandir en vue complete.

Mini-cockpit par session :
- M3 Elevated Card
- Jauge circulaire compacte (80px) + % + zone
- Tokens absolus + prediction
- Wave active + progression
- Agents nombre + statuts
- Sparkline 1h
- Statut resume pre-emptif

Vue zoomee = cockpit complet :
- Zone 1 : ContextGauge + PredictionCard + ConsumptionChart (toggle 5h/24h/7j)
- Zone 2 : AgentTree (gauche) + AgentTimeline (droite, scroll horizontal)
- Zone 3 : WavePipeline (colonnes horizontales) + WaveWaterfall (detail wave selectionnee)

---

## 9. Plan d'Implementation

### Phases

| Phase | Contenu | Dependances |
|-------|---------|-------------|
| **1. Fondations** | Design System M3 + Schema DB + tokens/realtime + statusline | Aucune |
| **2. Moteur contexte** | Calibration + Projection + Seuil 85% + Resume headless + PostCompact | Phase 1 |
| **3. Layout M3** | CSS vars + NavigationRail + TopAppBar + StatusBar + Snackbar | Phase 1 |
| **4. Cockpit** | Endpoints cockpit + Mini-cockpits + Zoom + Gauges + Timeline + Waves | Phase 2 + 3 |
| **5. Refonte pages** | 12 pages existantes en M3 | Phase 3 |
| **6. WebSocket enrichi** | Nouveaux events + channels multi-session + hooks frontend | Phase 1 |

### Fichiers a creer

```
context-manager/
  src/api/tokens-realtime.ts
  src/api/cockpit.ts
  src/api/compact-preemptive.ts
  src/api/calibration.ts
  src/db/migrations/004_v4_context.sql
  scripts/preemptive-summarize.sh
  hooks/statusline-dcm.sh

context-dashboard/
  src/components/layout/NavigationRail.tsx
  src/components/layout/TopAppBar.tsx
  src/components/layout/StatusBar.tsx
  src/components/layout/ThemeToggle.tsx
  src/components/ui/Snackbar.tsx
  src/components/ui/CircularProgress.tsx
  src/components/ui/LinearProgress.tsx
  src/components/ui/Chip.tsx
  src/components/cockpit/SessionMiniCockpit.tsx
  src/components/cockpit/CockpitGrid.tsx
  src/components/cockpit/CockpitZoom.tsx
  src/components/cockpit/ContextGauge.tsx
  src/components/cockpit/PredictionCard.tsx
  src/components/cockpit/ConsumptionChart.tsx
  src/components/cockpit/AgentTree.tsx
  src/components/cockpit/AgentTimeline.tsx
  src/components/cockpit/WavePipeline.tsx
  src/components/cockpit/WaveWaterfall.tsx
  src/hooks/useGlobalCapacity.ts
  src/hooks/useSessionGrid.ts
  src/hooks/usePreemptiveSummary.ts
  src/hooks/useContextProjection.ts
  src/app/cockpit/page.tsx
```

### Fichiers a modifier

```
context-manager/
  src/server.ts
  src/db/schema.sql
  src/api/compact.ts
  src/api/tokens.ts
  src/websocket/server.ts
  hooks/post-compact-restore.sh

context-dashboard/
  src/app/globals.css
  tailwind.config.ts
  src/app/layout.tsx
  src/lib/api-client.ts
  src/hooks/useWebSocket.ts
  src/app/*/page.tsx (12 pages)
  src/components/dashboard/* (refonte M3)
  src/components/charts/* (couleurs M3)
```

### Fichiers a supprimer

```
context-dashboard/
  src/components/layout/Sidebar.tsx → remplace par NavigationRail
  src/components/dashboard/SystemPulseBar.tsx → remplace par StatusBar
```

---

## 10. Decision Log

| # | Decision | Alternatives | Raison |
|---|----------|-------------|--------|
| 1 | Tokens reels via statusline | Hooks, API directe, estimation | Statusline = seule source de tokens reels |
| 2 | Compaction pre-emptive | Forcer /compact, alerter user | /compact non declenchable programmatiquement |
| 3 | Seuil 85% fixe + resume complet | Dynamique, par agent | Simple, fiable, 15% de marge |
| 4 | Agent headless claude -p --bare | API Anthropic, regles troncation | Resume plus riche, comprend le contexte |
| 5 | Contextes par modele reel | Budget dynamique, custom | Specs Anthropic fiables |
| 6 | max_capacity reutilise | Nouvelle colonne | Evite doublon |
| 7 | Cockpit multi-monitor | Selecteur, tabs, empile | Vue simultanee toutes sessions |
| 8 | StatusBar agrege global | Critique seule, segments | Synthese rapide sans surcharge |
| 9 | Resumes headless paralleles | FIFO, pool limite | Pas de raison de limiter |
| 10 | Material Design 3 | shadcn, custom | Coherence, accessibilite, dark/light natif |
| 11 | Navigation Rail (72px) | Sidebar 264px | +192px contenu |
| 12 | Arbre + Timeline | Graph, swimlanes | Hierarchie + temporalite unifiees |
| 13 | Pipeline + Waterfall | Gantt, Kanban seul | Flux visuel + detail granulaire |

---

## 11. Hypotheses

- Le statusline est configurable pour executer un script custom
- `claude -p --bare` est disponible dans l'environnement de DCM
- Les sub-agents heritent du session_id parent
- La machine supporte plusieurs process headless en parallele
- Les WebSocket supportent le broadcast multi-channel par session

## 12. Risques

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Statusline pas assez frequent | Tokens en retard de 2-5s | Acceptable pour un dashboard |
| Resume headless echoue | Fallback sur snapshot standard | Deja implemente |
| Charge CPU multi-resumes | Ralentissement machine | Choix utilisateur, documentable |
| Latence endpoint cockpit (5 requetes DB) | UI lente | Cache 2s cote serveur |
