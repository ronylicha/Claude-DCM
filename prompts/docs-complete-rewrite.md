# DCM Documentation Complete Rewrite - Multi-Agent Prompt

<context>
Tu travailles sur **DCM (Distributed Context Manager)**, un systeme de gestion de contexte distribue pour les sessions multi-agents Claude Code.

**Stack technique :**
- Backend API : Bun + Hono (port 3847)
- WebSocket : Bun native WS (port 3849)
- Dashboard : Next.js 16 (port 3848)
- Base de donnees : PostgreSQL 16 (10 tables, 4 views, JSONB metadata)
- Hooks : Bash scripts integres via plugin Claude Code

**Repo racine :** `/home/rony/Assets Projets/Claude-DCM/`
**Sous-dossiers principaux :** `context-manager/` (API + hooks), `context-dashboard/` (frontend)

**Codebase existante :** ~60 fichiers source TypeScript, ~12 hooks bash, 1 CLI wrapper, schema SQL complet.
</context>

<objective>
Produire une documentation complete et professionnelle du projet DCM en 4 livrables :

1. **README.md** - Page vitrine complete avec illustrations generees
2. **Wiki** (dossier `docs/wiki/`) - Documentation technique approfondie
3. **OpenAPI Spec** (`docs/api/openapi.yaml`) - Specification API complete
4. **Swagger UI** integration ou page HTML standalone
</objective>

---

## Phase 0 : Exploration du Codebase (OBLIGATOIRE)

<instructions>
**Agent :** `explore-codebase`
**Skill :** `/explore`

Explore TOUT le codebase pour extraire :

1. **Architecture globale** : dossiers, fichiers cles, dependances
2. **Tous les endpoints API** : methode, route, handler, parametres, reponses
   - Fichier source : `context-manager/src/server.ts` (toutes les routes)
   - Handlers : `context-manager/src/api/*.ts`
3. **Schema base de donnees** : tables, colonnes, types, relations
   - Migration : `context-manager/src/db/schema.sql` ou equivalent
4. **Hooks systeme** : event, matcher, script, timeout, comportement
   - Config : `context-manager/hooks/hooks.json`
   - Scripts : `context-manager/hooks/*.sh`
5. **CLI** : commandes disponibles via `context-manager/dcm`
6. **WebSocket** : events, format messages, auth
7. **Dashboard** : pages, composants, fonctionnalites

Genere un fichier `docs/_codebase-analysis.md` avec toute cette information structuree.
</instructions>

---

## Phase 1 : README.md

<instructions>
**Agent :** `docs-writer`
**Skills :** `/crafting-effective-readmes`, `/generate-image`

### Structure du README :

```markdown
# DCM - Distributed Context Manager

[ILLUSTRATION: Hero banner - generate-image]

> One-liner description percutante

## Le Probleme
[Expliquer pourquoi DCM existe - contexte perdu lors des compacts, agents deconnectes, etc.]

## La Solution
[ILLUSTRATION: Architecture diagram - generate-image]
[Comment DCM resout ca - monitoring, save/restore, communication inter-agents]

## Fonctionnalites Cles
[Liste avec icones/emojis des features principales]

### Context Guardian (4 couches)
[ILLUSTRATION: Flow diagram du monitoring multi-couche - generate-image]
- Couche 1: Guardian local (chaque appel, <10ms)
- Couche 2: Monitor API (chaque 5 appels)
- Couche 3: Stop Guard (dernier rempart)
- Couche 4: PreCompact/Restore (sauvegarde/restauration)

### Communication Inter-Agents
[Pub/sub, messages, subscriptions, blocking]

### Orchestration
[Waves, batches, decomposition, craft-prompt]

### Dashboard Temps Reel
[ILLUSTRATION: Screenshot du dashboard - generate-image]
[KPIs, sessions, agents, messages]

## Quick Start

### Prerequisites
- Bun >= 1.x
- PostgreSQL 16
- Claude Code avec plugin support

### Installation
\```bash
git clone <repo>
cd Claude-DCM/context-manager
bun install
./dcm install
./dcm start
\```

### Verification
\```bash
./dcm status
curl http://127.0.0.1:3847/health | jq .
\```

## Architecture
[ILLUSTRATION: C4 Container diagram - generate-image]

| Composant | Port | Role |
|-----------|------|------|
| API Hono | 3847 | REST API + business logic |
| WebSocket | 3849 | Real-time events |
| Dashboard | 3848 | Monitoring UI |
| PostgreSQL | 5432 | Persistence |

## API Reference
[Lien vers docs/api/]
[Resume des endpoints principaux avec exemples curl]

## Hooks System
[Tableau des hooks avec event, script, timeout]

## CLI Reference
\```bash
dcm install    # Install hooks + DB schema
dcm start      # Start all services
dcm stop       # Stop all services
dcm status     # Check service health
dcm hooks      # Inject hooks into settings.json
dcm unhook     # Remove hooks from settings.json
\```

## Configuration
[Variables d'environnement, fichiers de config]

## Contributing
[Guidelines, PR process]

## License
[License info]
```

### Instructions pour /generate-image :

Pour chaque illustration, utiliser le skill `/generate-image` avec ces prompts :

1. **Hero Banner** : "A futuristic dark-themed banner for 'DCM - Distributed Context Manager'. Show interconnected AI agents sharing context through glowing neural pathways. Colors: deep blue, electric cyan, white accents. Style: clean tech illustration, no text."

2. **Architecture Diagram** : "A clean technical architecture diagram showing 4 connected components: API Server (Hono), WebSocket Server, Dashboard (Next.js), and PostgreSQL database. Show data flow arrows between them. Style: flat design, dark background, neon accents."

3. **Guardian Flow** : "A layered defense diagram showing 4 protection layers for context management: Layer 1 (local check, green), Layer 2 (API check, yellow), Layer 3 (stop guard, orange), Layer 4 (compact save/restore, red). Funnel shape from top to bottom. Style: technical infographic."

4. **Dashboard Screenshot** : Utiliser une capture reelle du dashboard a `http://localhost:3848` ou generer un mockup.

</instructions>

---

## Phase 2 : Wiki (docs/wiki/)

<instructions>
**Agent :** `docs-architect`
**Skills :** `/codebase-documenter`, `/documentation-generation:architecture-decision-records`

### Structure du Wiki :

```
docs/wiki/
├── 00-overview.md              # Vue d'ensemble du projet
├── 01-getting-started.md       # Installation detaillee + troubleshooting
├── 02-architecture.md          # Architecture C4 (Context, Container, Component)
├── 03-api-reference.md         # Reference API complete (lien openapi)
├── 04-hooks-system.md          # Systeme de hooks en detail
├── 05-context-guardian.md      # Les 4 couches du guardian
├── 06-compact-lifecycle.md     # Cycle compact : save → compact → restore
├── 07-inter-agent-comm.md      # Messages, subscriptions, blocking
├── 08-orchestration.md         # Waves, batches, decomposition
├── 09-websocket.md             # Protocol WS, auth, events
├── 10-dashboard.md             # Pages, KPIs, navigation
├── 11-database-schema.md       # Tables, views, migrations
├── 12-cli-reference.md         # Toutes les commandes dcm
├── 13-configuration.md         # Env vars, timeouts, thresholds
├── 14-troubleshooting.md       # Problemes courants + solutions
├── 15-contributing.md          # Guidelines developpeurs
└── 16-changelog.md             # Historique des versions
```

### Contenu detaille par page :

**02-architecture.md** doit inclure :
- Diagramme Mermaid du flux de donnees
- Diagramme Mermaid de la base de donnees (ERD)
- Diagramme Mermaid du lifecycle des hooks

**04-hooks-system.md** doit inclure :
- Tableau complet de chaque hook (event, matcher, script, timeout)
- Diagramme sequence Mermaid du flux PostToolUse
- Diagramme sequence Mermaid du flux Compact
- Code examples des outputs JSON attendus
- Guide pour creer un nouveau hook

**05-context-guardian.md** doit inclure :
- Explication de chaque couche avec seuils
- Tableau des seuils et actions
- Diagramme de decision (flowchart Mermaid)
- Exemples de logs pour chaque zone (green/yellow/orange/red/critical)

**11-database-schema.md** doit inclure :
- ERD Mermaid complet
- Description de chaque table et colonne
- Index, contraintes, valeurs par defaut
- Requetes SQL utiles pour debug

Pour chaque page wiki, utiliser `/generate-image` pour creer 1-2 illustrations pertinentes.
</instructions>

---

## Phase 3 : OpenAPI Specification

<instructions>
**Agent :** `api-documenter` (documentation-generation)
**Skills :** `/documentation-generation:openapi-spec-generation`, `/api-documenter`

### Fichier cible : `docs/api/openapi.yaml`

Generer une specification OpenAPI 3.1 COMPLETE a partir de :
- `context-manager/src/server.ts` (toutes les routes)
- `context-manager/src/api/*.ts` (tous les handlers)
- Schemas Zod dans chaque handler (convertir en JSON Schema)

### Exigences :

1. **Chaque endpoint** doit avoir :
   - Summary + description
   - Parameters (path, query, header)
   - Request body schema avec exemples
   - Response schemas (200, 400, 404, 500)
   - Tags pour grouper par domaine

2. **Tags (groupes)** :
   - `Health` : /health, /stats
   - `Projects` : /api/projects/*
   - `Sessions` : /api/sessions/*
   - `Requests` : /api/requests/*
   - `Tasks` : /api/tasks/*
   - `Subtasks` : /api/subtasks/*
   - `Actions` : /api/actions/*
   - `Routing` : /api/routing/*
   - `Context` : /api/context/*, /api/compact/*
   - `Messages` : /api/messages/*
   - `Subscriptions` : /api/subscribe, /api/subscriptions/*
   - `Blocking` : /api/blocking/*
   - `Tokens` : /api/tokens/*, /api/capacity/*
   - `Registry` : /api/registry/*
   - `Orchestration` : /api/orchestration/*
   - `Waves` : /api/waves/*
   - `Dashboard` : /api/dashboard/*
   - `Auth` : /api/auth/*

3. **Schemas reutilisables** dans `components/schemas/` :
   - Project, Session, Request, Task, Subtask
   - AgentContext, AgentCapacity, TokenConsumption
   - Message, Subscription, Blocking
   - Wave, Batch, ContextBrief
   - Error (format standard)

4. **Exemples curl** pour chaque endpoint dans `x-codeSamples`

5. **Security** : Documenter l'auth token pour WebSocket

### Fichier supplementaire : `docs/api/swagger.html`

Creer une page HTML standalone qui charge Swagger UI depuis CDN :

```html
<!DOCTYPE html>
<html>
<head>
  <title>DCM API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: './openapi.yaml',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>
```
</instructions>

---

## Phase 4 : Illustrations avec /generate-image

<instructions>
**Skill :** `/generate-image`

Generer ces illustrations dans `docs/images/` :

| Fichier | Prompt pour generate-image |
|---------|---------------------------|
| `hero-banner.png` | "Futuristic dark-themed banner for DCM Distributed Context Manager. Interconnected AI agents sharing context through glowing neural pathways. Deep blue, electric cyan, white. Clean tech illustration, no text, 16:9 ratio." |
| `architecture-overview.png` | "Clean technical architecture diagram: API Server, WebSocket Server, Dashboard, PostgreSQL connected with data flow arrows. Flat design, dark background, neon blue/cyan accents, labeled boxes." |
| `guardian-layers.png` | "4-layer defense system infographic. Top layer green (local check), second yellow (API check), third orange (stop guard), bottom red (compact save). Funnel shape, technical style, dark theme." |
| `hook-lifecycle.png` | "Timeline diagram showing Claude Code session lifecycle: SessionStart → PostToolUse (repeated) → PreCompact → SessionStart(compact) → PostToolUse → SessionEnd. Tech infographic style, dark theme." |
| `compact-flow.png` | "Data flow diagram: PreCompact saves state → Claude compacts → SessionStart restores state. Show data being compressed and restored. Cyberpunk tech style, blue/cyan palette." |
| `inter-agent-comm.png` | "Multiple AI agents communicating via pub/sub messaging system. Show agents as nodes, messages as glowing packets traveling between them. Network topology style, dark background." |
| `wave-orchestration.png` | "Sequential wave execution diagram showing Wave -1 through Wave 8, each with different tasks flowing left to right. Gantt-chart inspired, tech style, color-coded waves." |

</instructions>

---

## Execution Sequentielle

<constraints>
### Ordre d'execution OBLIGATOIRE :

1. **Phase 0** en premier (exploration = fondation pour tout le reste)
2. **Phase 3** (OpenAPI) en parallele avec **Phase 4** (images)
3. **Phase 2** (Wiki) apres Phase 0 (besoin de l'analyse)
4. **Phase 1** (README) en dernier (synthetise tout)

### Agents et Skills par Phase :

| Phase | Agents | Skills |
|-------|--------|--------|
| 0 - Explore | `explore-codebase` | `/explore` |
| 1 - README | `docs-writer` | `/crafting-effective-readmes`, `/generate-image` |
| 2 - Wiki | `docs-architect`, `technical-writer` | `/codebase-documenter`, `/mermaid-diagrams` |
| 3 - OpenAPI | `api-documenter` | `/api-documenter`, `/documentation-generation:openapi-spec-generation` |
| 4 - Images | direct skill | `/generate-image` |

### Regles :
- TOUJOURS lire le fichier source AVANT de documenter un endpoint
- TOUJOURS inclure des exemples curl fonctionnels (tester avec le serveur local)
- TOUJOURS utiliser des diagrammes Mermaid dans le wiki
- TOUJOURS generer les images via `/generate-image` (pas de placeholders)
- Les schemas Zod dans le code sont la source de verite pour les request/response bodies
- Base URL pour exemples : `http://127.0.0.1:3847`
- Ports : API 3847, WS 3849, Dashboard 3848
</constraints>

<success_criteria>
### Le livrable est complet quand :

- [ ] `README.md` reecrit avec 5+ illustrations generees
- [ ] `docs/wiki/` contient 16 pages markdown avec diagrammes Mermaid
- [ ] `docs/api/openapi.yaml` couvre TOUS les endpoints de server.ts
- [ ] `docs/api/swagger.html` fonctionne en standalone
- [ ] `docs/images/` contient 7+ illustrations generees
- [ ] Chaque endpoint a : description, params, body schema, response schema, exemple curl
- [ ] Tous les hooks documentes avec event, matcher, timeout, comportement
- [ ] Schema DB documente avec ERD Mermaid
- [ ] Zero placeholder ou TODO restant
</success_criteria>
