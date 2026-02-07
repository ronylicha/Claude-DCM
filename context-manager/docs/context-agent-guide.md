# Guide d'intégration Context Agent avec DCM

Ce guide explique comment utiliser l'agent `context-keeper` avec le Distributed Context Manager pour maintenir et restaurer le contexte entre les sessions Claude Code.

## Vue d'ensemble

Le DCM fournit une API dédiée pour la gestion de contexte des agents :
- Génération de briefs adaptés au type d'agent
- Restauration automatique après compact
- Tracking des tâches et dépendances
- Communication inter-agents

## Workflow de reprise de contexte

### 1. Détection du besoin de contexte

Quand utiliser la restauration de contexte :
- Au démarrage d'une nouvelle session
- Après un compact automatique de Claude
- Quand le contexte semble perdu
- Sur demande explicite de l'utilisateur

### 2. Appel à l'API Context

```bash
# Obtenir le contexte pour un agent
curl "http://127.0.0.1:3847/api/context/backend-laravel?session_id=session-123&format=brief&max_tokens=2000"
```

Réponse :

```json
{
  "agent_id": "backend-laravel",
  "session_id": "session-123",
  "format": "brief",
  "brief": "## Contexte Session\n\n### Objectif\nImplémenter OAuth2...\n\n### Tâches complétées\n- Migration oauth_tokens\n...",
  "data": {
    "project": { ... },
    "pending_subtasks": [ ... ],
    "running_subtasks": [ ... ],
    "recent_messages": [ ... ]
  },
  "generated_at": "2024-01-30T12:00:00.000Z",
  "token_estimate": 1850
}
```

### 3. Restauration après compact

Quand Claude signale un compact, appeler :

```bash
curl -X POST http://127.0.0.1:3847/api/compact/restore \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session-123",
    "agent_id": "backend-laravel",
    "agent_type": "developer",
    "compact_summary": "Résumé du compact fourni par Claude",
    "max_tokens": 4000
  }'
```

## Templates de brief par catégorie d'agent

Le DCM génère des briefs adaptés au rôle de l'agent :

### Orchestrator (project-supervisor, tech-lead)

```markdown
## Mission Globale
[Objectif principal de la session]

## État actuel
- Tâches en cours : X
- Tâches en attente : Y
- Blocages : Z

## Prochaines actions
1. [Action prioritaire]
2. [Action suivante]

## Coordination
[Agents impliqués et leurs statuts]
```

### Developer (backend-*, frontend-*, database-*)

```markdown
## Contexte technique
[Stack, contraintes, patterns]

## Tâche assignée
[Description de la tâche actuelle]

## Dépendances
- [Fichiers à modifier]
- [APIs à utiliser]

## Tests requis
[Critères de validation]
```

### Validator (qa-testing, security-*, regression-guard)

```markdown
## Scope de validation
[Ce qui doit être testé]

## Critères d'acceptation
- [ ] [Critère 1]
- [ ] [Critère 2]

## Historique des modifications
[Fichiers changés récemment]

## Risques identifiés
[Points d'attention]
```

### Specialist (*-specialist, *-expert)

```markdown
## Domaine d'expertise requis
[Compétence spécifique]

## Contexte du problème
[Description du besoin]

## Contraintes
[Limites, bonnes pratiques]

## Ressources disponibles
[Documentation, exemples]
```

## Implémentation dans context-keeper

L'agent `context-keeper` utilise ces APIs ainsi :

### Au démarrage de session

```typescript
async function initializeContext(sessionId: string, agentType: string): Promise<void> {
  // 1. Vérifier si une session existe
  const status = await fetch(`/api/compact/status/${sessionId}`);
  const { exists, compacted } = await status.json();

  if (!exists) {
    // Nouvelle session, créer le projet
    await createProject(sessionId);
    return;
  }

  if (compacted) {
    // Session compactée, restaurer
    await restoreContext(sessionId, agentType);
    return;
  }

  // Session existante, récupérer le contexte actuel
  const context = await getContext(sessionId, agentType);
  injectContext(context);
}
```

### Génération de brief à la demande

```typescript
async function generateBrief(agentId: string, sessionId: string): Promise<string> {
  const response = await fetch('/api/context/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_id: agentId,
      session_id: sessionId,
      max_tokens: 2000
    })
  });

  const { brief } = await response.json();
  return brief;
}
```

### Écoute des événements WebSocket

```typescript
const ws = new WebSocket('ws://127.0.0.1:3849?agent_id=context-keeper');

ws.onopen = () => {
  // S'abonner aux événements de tâches
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'tasks.*'
  }));

  // S'abonner aux événements de subtasks
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'subtasks.*'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'event':
      handleTaskEvent(data.payload);
      break;
  }
};
```

## Paramètres de l'API Context

| Paramètre | Type | Default | Description |
|-----------|------|---------|-------------|
| `session_id` | string | - | ID de la session Claude |
| `agent_type` | string | auto-detect | Type d'agent pour le template |
| `format` | string | brief | `brief` ou `raw` |
| `max_tokens` | number | 2000 | Limite de tokens pour le brief |
| `include_completed` | boolean | false | Inclure les tâches complétées |
| `include_messages` | boolean | true | Inclure les messages récents |

## Bonnes pratiques

### 1. Limiter les tokens

Toujours spécifier `max_tokens` pour éviter de dépasser la fenêtre de contexte :

```bash
# Pour un brief rapide
?max_tokens=1000

# Pour une restauration complète
?max_tokens=4000
```

### 2. Utiliser le bon format

- `format=brief` : Pour l'injection dans le prompt (markdown formaté)
- `format=raw` : Pour le traitement programmatique (JSON structuré)

### 3. Gérer les échecs gracieusement

```typescript
async function safeGetContext(sessionId: string): Promise<string> {
  try {
    const response = await fetch(`/api/context/...`);
    if (!response.ok) {
      // API indisponible, utiliser le fallback
      return await readMasterPlan(sessionId);
    }
    return (await response.json()).brief;
  } catch (error) {
    console.warn('DCM unavailable, using local context');
    return await readMasterPlan(sessionId);
  }
}
```

### 4. Synchroniser avec le Knowledge Graph

Le DCM complète le Knowledge Graph (MCP Memory) :

| Système | Usage |
|---------|-------|
| DCM | Contexte de session, tâches, hiérarchie |
| Knowledge Graph | Entités persistantes, relations, apprentissage |

```typescript
// Après restauration DCM, synchroniser avec KG
const context = await getContextFromDCM(sessionId);
await syncToKnowledgeGraph(context.data);
```

## Exemple complet de reprise

```typescript
/**
 * Workflow complet de reprise de contexte
 */
async function handleContextRecovery(
  sessionId: string,
  agentId: string,
  agentType: string,
  compactSummary?: string
): Promise<string> {
  const API_URL = 'http://127.0.0.1:3847';

  // 1. Vérifier le statut de la session
  const statusRes = await fetch(`${API_URL}/api/compact/status/${sessionId}`);
  const status = await statusRes.json();

  let brief: string;

  if (compactSummary) {
    // 2a. Restauration après compact
    const restoreRes = await fetch(`${API_URL}/api/compact/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        agent_id: agentId,
        agent_type: agentType,
        compact_summary: compactSummary,
        max_tokens: 4000
      })
    });
    const restore = await restoreRes.json();
    brief = restore.context_brief;
  } else {
    // 2b. Récupération normale du contexte
    const contextRes = await fetch(
      `${API_URL}/api/context/${agentId}?session_id=${sessionId}&format=brief&max_tokens=2000`
    );
    const context = await contextRes.json();
    brief = context.brief;
  }

  // 3. Formater pour l'injection
  return `
## REPRISE DE SESSION : ${sessionId}

${brief}

---
RAPPEL : Je suis orchestrateur, je DÉLÈGUE toujours aux agents spécialisés.
`;
}
```

## Dépannage

### Le contexte n'est pas restauré

1. Vérifier que le DCM est démarré :
   ```bash
   curl http://127.0.0.1:3847/health
   ```

2. Vérifier que la session existe :
   ```bash
   curl http://127.0.0.1:3847/api/compact/status/session-123
   ```

### Le brief est trop long

Réduire `max_tokens` ou exclure les tâches complétées :
```bash
?max_tokens=1500&include_completed=false
```

### Les messages ne sont pas inclus

Vérifier que le pub/sub fonctionne :
```bash
curl http://127.0.0.1:3847/api/cleanup/stats
```

## Migration depuis l'ancien système

Si vous migrez depuis le système SQLite (`routing.db`) :

1. Conserver `routing.db` comme backup
2. Exécuter le script de migration :
   ```bash
   bun run scripts/migrate-sqlite.ts
   ```
3. Mettre à jour les hooks pour utiliser la nouvelle API
4. Tester avec une session de test

Le DCM est rétro-compatible et peut fonctionner en parallèle pendant la transition.
