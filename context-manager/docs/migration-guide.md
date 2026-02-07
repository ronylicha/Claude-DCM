# Guide de migration SQLite vers DCM

Ce guide explique comment migrer de l'ancien système de tracking SQLite (`routing.db`) vers le Distributed Context Manager (PostgreSQL).

## Situation actuelle

### Ancien système (SQLite)

```
~/.claude/routing.db           # Base SQLite
~/.claude/hooks/schema.sql     # Schéma SQLite
~/.claude/hooks/scripts/track-usage.sh  # Hook SQLite
```

Tables SQLite :
- `tool_usage` - Historique d'utilisation des outils
- `keyword_tool_scores` - Scores de routage intelligent

### Nouveau système (DCM)

```
~/.claude/services/context-manager/
├── src/                       # Service API REST + WebSocket
├── hooks/track-usage.sh       # Hook REST API
└── scripts/migrate-sqlite.ts  # Script de migration
```

Tables PostgreSQL :
- `projects` - Projets suivis
- `requests` - Requêtes utilisateur
- `task_lists` - Listes de tâches (waves)
- `subtasks` - Tâches individuelles
- `actions` - Historique d'actions (equivalent tool_usage)
- `routing_scores` - Scores de routage
- `messages` - Messages inter-agents
- `subscriptions` - Abonnements pub/sub
- Et plus...

## Stratégie de migration

### Option 1: Migration progressive (recommandé)

Faire fonctionner les deux systèmes en parallèle pendant une période de transition.

**Avantages:**
- Pas de rupture de service
- Possibilité de rollback
- Temps pour valider le nouveau système

**Étapes:**

1. **Démarrer le DCM sans modifier les hooks**

   ```bash
   cd ~/.claude/services/context-manager
   bun install
   bun run start
   ```

2. **Tester l'API manuellement**

   ```bash
   curl http://127.0.0.1:3847/health
   curl -X POST http://127.0.0.1:3847/api/actions \
     -H "Content-Type: application/json" \
     -d '{"tool_name": "Test", "tool_type": "builtin", "project_path": "/test"}'
   ```

3. **Migrer les données historiques**

   ```bash
   bun run scripts/migrate-sqlite.ts
   ```

4. **Ajouter le nouveau hook en parallèle**

   Dans `~/.claude/settings.json`, ajouter un second hook :

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "*",
           "hooks": [
             {
               "type": "command",
               "command": "(nohup bash ~/.claude/hooks/scripts/track-usage.sh \"$TOOL_EXIT_CODE\" >/dev/null 2>&1 &)"
             },
             {
               "type": "command",
               "command": "(nohup bash ~/.claude/services/context-manager/hooks/track-usage.sh >/dev/null 2>&1 &)"
             }
           ]
         }
       ]
     }
   }
   ```

5. **Valider pendant 1-2 semaines**

   - Comparer les données entre SQLite et PostgreSQL
   - Tester le dashboard
   - Vérifier le routage intelligent

6. **Basculer complètement**

   Une fois validé, retirer l'ancien hook et garder seulement le nouveau.

### Option 2: Migration big-bang

Migrer tout d'un coup (plus risqué mais plus rapide).

**Étapes:**

1. **Sauvegarder l'ancien système**

   ```bash
   cp ~/.claude/routing.db ~/.claude/routing.db.backup
   ```

2. **Démarrer le DCM**

   ```bash
   cd ~/.claude/services/context-manager
   bun install
   bun run start
   ```

3. **Migrer les données**

   ```bash
   bun run scripts/migrate-sqlite.ts
   ```

4. **Modifier settings.json**

   Remplacer l'ancien hook par le nouveau :

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "*",
           "hooks": [
             {
               "type": "command",
               "command": "(nohup bash ~/.claude/services/context-manager/hooks/track-usage.sh >/dev/null 2>&1 &)"
             }
           ]
         }
       ]
     }
   }
   ```

5. **Tester immédiatement**

## Script de migration des données

Le script `migrate-sqlite.ts` fait la correspondance suivante :

| SQLite (tool_usage) | PostgreSQL (actions) |
|---------------------|---------------------|
| session_id | session_id |
| tool_name | tool_name |
| tool_type | tool_type |
| file_paths | file_paths (JSON array) |
| exit_code | exit_code |
| duration_ms | duration_ms |
| project_path | project_path |
| created_at | created_at |

| SQLite (keyword_tool_scores) | PostgreSQL (routing_scores) |
|-----------------------------|----------------------------|
| keyword | keywords (JSON array) |
| tool_name | tool_name |
| tool_type | tool_type |
| score | weight |
| usage_count | usage_count |
| success_count | success_count |

## Rollback

Si la migration échoue :

1. **Restaurer le hook SQLite**

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "*",
           "hooks": [
             {
               "type": "command",
               "command": "(nohup bash ~/.claude/hooks/scripts/track-usage.sh \"$TOOL_EXIT_CODE\" >/dev/null 2>&1 &)"
             }
           ]
         }
       ]
     }
   }
   ```

2. **Arrêter le DCM**

   ```bash
   # Trouver et tuer les processus
   pkill -f "bun.*context-manager"
   ```

3. **Restaurer le backup si nécessaire**

   ```bash
   cp ~/.claude/routing.db.backup ~/.claude/routing.db
   ```

## Vérification post-migration

### Checklist

- [ ] Le service API répond sur le port 3847
- [ ] Le service WebSocket répond sur le port 3849
- [ ] Le health check retourne "healthy"
- [ ] Les actions sont enregistrées dans PostgreSQL
- [ ] Le routage intelligent fonctionne
- [ ] Le dashboard affiche des données

### Commandes de vérification

```bash
# Health check
curl http://127.0.0.1:3847/health

# Dernières actions
curl http://127.0.0.1:3847/api/actions?limit=5

# Stats
curl http://127.0.0.1:3847/stats

# Routage
curl "http://127.0.0.1:3847/api/routing/suggest?q=test"
```

### Comparer les données

```bash
# Compter les enregistrements SQLite
sqlite3 ~/.claude/routing.db "SELECT COUNT(*) FROM tool_usage;"

# Compter les enregistrements PostgreSQL
psql -d claude_context -c "SELECT COUNT(*) FROM actions;"
```

## Conservation de l'ancien système

Même après la migration complète, il est recommandé de conserver :

- `~/.claude/routing.db` - Comme backup historique
- `~/.claude/hooks/scripts/track-usage.sh` - Au cas où
- `~/.claude/hooks/schema.sql` - Pour référence

Ces fichiers ne prennent pas beaucoup de place et peuvent être utiles en cas de besoin de rollback.

## Support

En cas de problème :

1. Vérifier les logs du DCM
2. Consulter `/home/rony/.claude/services/context-manager/docs/`
3. Tester les endpoints manuellement avec curl
4. Vérifier la connexion PostgreSQL

```bash
# Debug complet
DEBUG_ROUTING=1 bash ~/.claude/services/context-manager/hooks/track-usage.sh

# Logs PostgreSQL
tail -f /var/log/postgresql/postgresql-*-main.log
```
