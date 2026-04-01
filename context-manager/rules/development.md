# Development Rules

## API Documentation

- **New project**: Verify OpenAPI + Swagger exist, create if missing (except mobile apps -> use .md format)
- **New endpoint**: Update OpenAPI with examples (curl, PHP, JavaScript, Python)
- **Translations**: Translate API texts and comments in languages specified in local CLAUDE.md

## Code Quality

- **Coverage minimum**: 80%
- **Review**: Mandatory
- **Documentation**: Mandatory

## Compliance Requirements

- RGPD (always)
- HDS (if health data)
- eIDAS (if electronic signatures)
- Factur-X (if invoicing)

---

## Principes de Code (OBLIGATOIRE)

### KISS - Keep It Simple

- Solution la plus simple qui fonctionne
- Pas de sur-ingenierie
- Pas d'optimisation prematuree
- Comprehensible > astucieux

### DRY - Don't Repeat Yourself

- Extraire la logique commune en fonctions/services
- Creer des composants reutilisables
- Partager les utilitaires entre modules
- Interdiction du copier-coller de logique

### YAGNI - You Aren't Gonna Need It

- Ne pas construire avant le besoin reel
- Pas de generalisation speculative
- Commencer simple, refactoriser quand necessaire

---

## Nommage

### Variables

```
OBLIGATOIRE : Noms descriptifs
  marketSearchQuery, isUserAuthenticated, totalRevenue

INTERDIT : Noms obscurs
  q, flag, x, temp, data2
```

### Fonctions

```
OBLIGATOIRE : Pattern verbe-nom
  fetchMarketData(), calculateSimilarity(), isValidEmail()

INTERDIT : Noms vagues
  process(), handle(), doStuff()
```

### Fichiers

| Type | Convention | Exemple |
|------|-----------|---------|
| Composant React | PascalCase | `UserCard.tsx` |
| Hook React | camelCase + use | `useAuth.ts` |
| Utilitaire | camelCase | `formatDate.ts` |
| Type | camelCase + .types | `user.types.ts` |
| Controller PHP | PascalCase + Controller | `UserController.php` |
| Service PHP | PascalCase + Service | `UserService.php` |
| Migration | snake_case date-prefixed | `2024_01_01_create_users_table.php` |

---

## Immutabilite (CRITIQUE)

```typescript
// OBLIGATOIRE : spread operator
const updated = { ...user, name: 'New' };
const newArray = [...items, newItem];

// INTERDIT : mutation directe
user.name = 'New';
items.push(newItem);
```

---

## Error Handling

```typescript
// OBLIGATOIRE : gestion comprehensive
async function fetchData(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Fetch failed:', error);
    throw new Error('Failed to fetch data');
  }
}

// INTERDIT : pas de gestion d'erreur
const response = await fetch(url);
return response.json();
```

---

## Async/Await

```typescript
// OBLIGATOIRE : paralleliser les operations independantes
const [users, markets, stats] = await Promise.all([
  fetchUsers(),
  fetchMarkets(),
  fetchStats(),
]);

// INTERDIT : sequentiel quand pas necessaire
const users = await fetchUsers();
const markets = await fetchMarkets();
const stats = await fetchStats();
```

---

## Type Safety

```typescript
// OBLIGATOIRE : types explicites
interface Market {
  id: string;
  name: string;
  status: 'active' | 'resolved' | 'closed';
}

function getMarket(id: string): Promise<Market> { /* ... */ }

// INTERDIT : any
function getMarket(id: any): Promise<any> { /* ... */ }
```

---

## Commentaires

```typescript
// OBLIGATOIRE : expliquer le POURQUOI
// Backoff exponentiel pour eviter de surcharger l'API en cas de panne
const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);

// INTERDIT : expliquer le QUOI (evident)
// Incrementer le compteur
count++;
```

### JSDoc pour les API publiques

```typescript
/**
 * Recherche par similarite semantique.
 * @param query - Requete en langage naturel
 * @param limit - Nombre max de resultats (defaut: 10)
 * @returns Resultats tries par score de similarite
 * @throws {Error} Si l'API est indisponible
 */
export async function search(query: string, limit = 10): Promise<Result[]> {}
```

---

## Code Smells (a detecter et corriger)

| Smell | Seuil | Correction |
|-------|-------|------------|
| Fonction longue | > 50 lignes | Decouper en sous-fonctions |
| Nesting profond | > 3 niveaux | Early return |
| Nombres magiques | Tout literal non-nomme | Constante nommee |
| Parametres excessifs | > 4 params | Objet de configuration |
| Classe/fichier massif | > 300 lignes | Decouper par responsabilite |
| Code duplique | > 3 occurrences | Extraire en fonction/composant |

### Early Return (OBLIGATOIRE)

```typescript
// OBLIGATOIRE
if (!user) return;
if (!user.isAdmin) return;
if (!hasPermission) return;
// logique principale ici

// INTERDIT
if (user) {
  if (user.isAdmin) {
    if (hasPermission) {
      // logique enfouie
    }
  }
}
```

---

## Git Workflow

### Commits

- Messages concis, en imperatif
- Format : `type(scope): description`
- Types : `feat`, `fix`, `refactor`, `docs`, `test`, `chore`
- Seulement sur demande explicite de l'utilisateur

### Branches

- `main` / `master` : production, protegee
- `develop` : integration
- `feature/xxx` : nouvelles fonctionnalites
- `fix/xxx` : corrections de bugs
- `hotfix/xxx` : corrections urgentes production

### Pull Requests

- Description claire avec contexte
- Tests passes
- Review obligatoire
- Pas de force push sur main/develop

---

## Testing Standards

### Pattern AAA

```typescript
test('returns empty array when no match', () => {
  // Arrange
  const items: Item[] = [];

  // Act
  const result = search(items, 'query');

  // Assert
  expect(result).toEqual([]);
});
```

### Nommage des Tests

```
OBLIGATOIRE : descriptif du comportement
  'returns empty array when no markets match query'
  'throws error when API key is missing'

INTERDIT : vague
  'works'
  'test search'
```

### Coverage

- Minimum 80% global
- 100% sur les chemins critiques (auth, paiement, donnees sensibles)
- Tester les etats : loading, error, success, empty
- Tester les cas limites et edge cases

---

## Anti-Patterns (INTERDIT)

| Anti-Pattern | Correction |
|-------------|------------|
| `any` en TypeScript | Types explicites |
| Mutation directe | Immutabilite (spread) |
| Nesting > 3 niveaux | Early return |
| Nombres magiques | Constantes nommees |
| Copier-coller | Extraire en fonction |
| Await sequentiel independant | `Promise.all()` |
| Pas de gestion d'erreur | try/catch + messages clairs |
| Commentaires obvies | Expliquer le pourquoi |
| Fonctions > 50 lignes | Decouper |
| `console.log` en prod | Logger structure |
