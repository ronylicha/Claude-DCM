# Protection & Workflow

## Seuils de Declenchement

| Taille tache | Impact Analyzer | Waves | Regression Guard |
|-------------|----------------|-------|-----------------|
| **Triviale** (1 ligne, typo, rename) | Non | Aucune | Non |
| **Simple** (1-3 fichiers, logique claire) | Non | Edit + test | Lancer tests existants |
| **Moyenne** (4-10 fichiers, 1 feature) | Oui (cible) | Waves ciblees | Oui (cible) |
| **Large** (10+ fichiers, multi-domaine) | Oui (complet) | Toutes (-1 a 8) | Oui (complet) |

### Comment Evaluer la Taille

```
1. Combien de fichiers seront modifies ?
2. Y a-t-il des changements d'API publique ?
3. Y a-t-il des modifications de schema DB ?
4. Le changement touche-t-il plusieurs domaines (back + front) ?

Si 1 seul fichier, pas d'API, pas de DB → Triviale
Si 1-3 fichiers, pas d'API publique → Simple
Si API ou DB touche, ou 4+ fichiers → Moyenne
Si multi-domaine ou 10+ fichiers → Large
```

---

## Protection Obligatoire (Taches Moyennes et Larges)

```
Request -> impact-analyzer (AVANT) -> Developpement -> regression-guard (APRES) -> Merge
```

- **impact-analyzer** : DOIT tourner AVANT toute modification code/DB/config
- **regression-guard** : DOIT tourner APRES toute modification, avant merge

### Quand TOUJOURS appliquer (quelle que soit la taille)

- Modification d'une migration existante
- Changement d'interface API publique
- Suppression de code utilise par d'autres fichiers
- Modification de config de securite/auth
- Changement de schema de base de donnees

---

## Execution par Waves

| Wave | Contenu | Quand l'appliquer |
|------|---------|-------------------|
| -1 | Impact analysis (OBLIGATOIRE pour Moyenne+) | Taches moyennes et larges |
| 0 | Legal/GDPR, API contracts | Si donnees sensibles ou nouvelle API |
| 1 | Migrations, Models, Seeders | Si changement DB |
| 2 | Controllers, Routes, Resources, Policies | Si changement API |
| 3 | TypeScript types, Hooks, DataProviders | Si changement frontend lié a l'API |
| 4 | UI Components (Atoms, Molecules, Organisms) | Si nouveaux composants |
| 5 | Pages, Layouts, Navigation | Si nouvelles pages |
| 6 | Tests, Security audit, Performance | Toujours pour Moyenne+ |
| 7 | Documentation, SEO, CI/CD | Si doc/deploy impacte |
| 8 | Anti-regression validation (OBLIGATOIRE pour Moyenne+) | Taches moyennes et larges |

### Waves pour Taches Simples

Pas besoin du systeme complet. Workflow :
1. Lire le fichier
2. Editer
3. Verifier que les tests passent
4. Fait

### Waves pour Taches Moyennes

Selectionner uniquement les waves pertinentes :
- Changement DB ? → Wave 1 + 6
- Changement API ? → Wave 2 + 3 + 6
- Changement UI ? → Wave 4 + 5 + 6
- Toujours Wave -1 (impact) et Wave 8 (regression)

-> Details des waves par contexte : `docs/multi-agent-architecture.md`

---

## Security Alerts

```
ALERT_{SESSION}_{AGENT}_{TIMESTAMP}

Level: CRITICAL | WARNING | INFO
Type: BREAKING_CHANGE | REGRESSION | CONTRACT_VIOLATION
Action: STOP -> Immediate halt | REVIEW -> Human validation | CONTINUE
```

### Exemples Concrets

```
ALERT_20260304_laravel-api_153200
Level: CRITICAL
Type: BREAKING_CHANGE
Detail: Endpoint POST /api/v1/users change de signature (champ 'role' supprime)
Action: STOP -> Valider avec tech-lead avant de continuer

ALERT_20260304_frontend-react_161500
Level: WARNING
Type: REGRESSION
Detail: Composant UserCard ne recoit plus la prop 'avatar'
Action: REVIEW -> Verifier si intentionnel
```

---

## Non-Regression

- Modifications to existing files -> Check callers
- Deletions -> `grep -rn '{nom_fonction_ou_classe}' --include='*.php' --include='*.ts' --include='*.tsx' .`
- API changes -> Migration mandatory before removal

---

## Delegation

### Taches Larges

Toutes les taches s'executent via Task tool avec `run_in_background: true`.
L'orchestrateur ne fait JAMAIS d'execution directe.

### Taches Simples/Moyennes

L'orchestrateur peut editer directement ou deleguer en foreground.
`run_in_background` optionnel.

---

## Taches Atomiques

Chaque tache doit etre :
- **1 fichier** cree/modifie
- **1 action** logique
- **< 5 minutes** d'execution
- **Dependances explicites** et minimales

---

## Fichiers Generes par Session (Taches Larges uniquement)

| Fichier | Usage |
|---------|-------|
| `L0_MASTER_PLAN.md` | Plan global (project-supervisor) |
| `L0_API_CONTRACTS.md` | Contrats API (tech-lead) |
| `contracts/types.ts` | Types TypeScript |
| `contracts/dtos.php` | Laravel DTOs |

---

## References

| Sujet | Fichier |
|-------|---------|
| Workflow System complet | `docs/workflow-system.md` |
| Templates (51) | `docs/workflow-templates.md` |
| Decision Tree | `docs/decision-tree.md` |
| Contexte & Sessions | `docs/context-and-sessions.md` |
