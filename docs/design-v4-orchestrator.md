# DCM v4.1 — Design: Orchestrateur Inter-Projets

> Date: 2026-03-28
> Statut: Valide (brainstorming complet)

## Vision

DCM passe de gestionnaire de sessions isolees a **coordinateur inter-projets**. Un orchestrateur Sonnet headless tourne en continu et coordonne toutes les sessions Claude actives.

## Architecture

```
Orchestrateur Global (Sonnet, singleton, long-running)
  │ poll 30s + WebSocket + SQL direct
  │ execute via API DCM existante
  ├── Delegate Claude-DCM (hook PostToolUse augmente)
  ├── Delegate IAAssistant (hook PostToolUse augmente)
  └── Delegate PratiConnect (hook PostToolUse augmente)
```

## Declenchement
- Automatique au `SessionStart` du premier projet
- Singleton protege par flock
- Arret auto apres 5 min sans session active

## Pouvoirs de l'orchestrateur
- Envoyer des infos cross-projet (decisions archi, schemas)
- Forcer compaction sur sessions a 85%+
- Stopper/pauser les sessions en conflit fichier
- Reordonner les priorites de taches
- Partager des artifacts entre projets

## Communication
- Via API existante (POST /api/messages, PATCH /api/subtasks, etc.)
- Les delegates lisent les directives toutes les 10 actions
- Injection dans le contexte de la session via additionalContext du hook

## Endpoint topologie
GET /api/orchestrator/topology
- nodes: sessions avec %, zone, agents
- edges: messages/directives entre sessions
- conflicts: fichiers modifies par 2+ sessions

## Visualisation
- Barre de statut orchestrateur dans le cockpit
- Topologie 3D (React Three Fiber) : spheres = sessions, lignes = messages
- Animations frame-based (style Remotion)

## Decision Log
1. claude -p --bare long-running (pas cron/daemon)
2. API existante pour communication (pas nouvelle table)
3. Delegate = hook augmente (pas process)
4. Check directives /10 actions (pas chaque action)
5. Singleton flock (pas multi-instance)
6. React Three Fiber pour 3D (pas SVG/D3)
7. Animations Remotion-style (frame-based)
