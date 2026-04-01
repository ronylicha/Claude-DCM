---

paths: "**/*.{tsx,ts,jsx,js}"
---

# Frontend React Rules

## Stack

- React 18/19
- TypeScript (strict mode)
- Vite (ou Next.js selon projet)
- Radix UI, Ant Design, Material UI, ou shadcn/ui (selon projet)
- Tailwind CSS (styling)
- Refine v5 (for admin interfaces, si utilise)

## Commands

```bash
pnpm dev           # Start development
pnpm lint          # ESLint
pnpm build         # Build production
pnpm type-check    # Check types (si configure)
```

## Agents to Use

| Task                         | Agent                                        |
| ---------------------------- | -------------------------------------------- |
| Components, hooks, state     | `frontend-react`                             |
| Admin CRUD, dataProviders    | `react-refine`                               |
| Design system, accessibility | `designer-ui-ux`, `accessibility-specialist` |
| i18n, translations           | `i18n-specialist`                            |
| Performance, optimization    | `performance-engineer`                       |
| Code review                  | `code-reviewer`                              |

## Key Rules

- **ALWAYS** follow types from `contracts/types.ts`
- **NEVER** bypass type contracts - escalate to `tech-lead`
- **NEVER** mutate state directly - toujours creer de nouvelles references
- **NEVER** utiliser des barrel imports depuis de grandes librairies
- **ALWAYS** utiliser `key` stable (ID) dans les listes, jamais l'index
- **ALWAYS** nettoyer les subscriptions et event listeners dans useEffect

## Component Structure (Atomic Design)

```
src/
├── components/
│   ├── atoms/      # Button, Input, Badge
│   ├── molecules/  # FormField, Card
│   └── organisms/  # Header, Sidebar
├── pages/
├── hooks/          # Custom hooks reutilisables
├── actions/        # Server Actions (si Next.js)
└── lib/            # Utilitaires, helpers
```

---

## React 19 - Server vs Client Components

### Server Components (defaut dans Next.js App Router)

- Utilisables pour le data fetching et le contenu statique
- **Interdits** : hooks, event handlers, browser APIs
- Passent les donnees en props aux Client Components

```tsx
// Server Component (defaut)
async function ProductPage({ id }: { id: string }) {
  const product = await db.product.findUnique({ where: { id } });
  return (
    <div>
      <h1>{product.name}</h1>
      <AddToCartButton productId={product.id} />
    </div>
  );
}
```

### Client Components

- Marques avec `'use client'` en haut du fichier
- Necessaires pour : hooks, state, event handlers, browser APIs
- **Minimiser** le nombre de Client Components

```tsx
'use client';
function AddToCartButton({ productId }: { productId: string }) {
  const [isPending, startTransition] = useTransition();
  const handleAdd = () => {
    startTransition(async () => {
      await addToCart(productId);
    });
  };
  return (
    <button onClick={handleAdd} disabled={isPending}>
      {isPending ? 'Adding...' : 'Add to Cart'}
    </button>
  );
}
```

### Server Actions

- Directive `'use server'` obligatoire en haut du fichier
- Valider les inputs avec Zod

```tsx
'use server';
import { z } from 'zod';

const schema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

export async function createPost(formData: FormData) {
  const result = schema.safeParse({
    title: formData.get('title'),
    content: formData.get('content'),
  });
  if (!result.success) return { error: result.error.flatten().fieldErrors };
  await db.post.create({ data: result.data });
  revalidatePath('/posts');
}
```

### Hooks React 19

| Hook | Usage |
|------|-------|
| `use()` | Lire une Promise ou un Context pendant le render |
| `useOptimistic()` | UI optimiste pour les operations async |
| `useFormStatus()` | Etat de soumission d'un formulaire (composant enfant) |
| `useFormState()` | Gestion d'etat de formulaire avec erreurs |
| `useTransition()` | Updates non-urgentes |
| `useDeferredValue()` | Reporter un render couteux |

---

## Performance - Regles par Priorite

### CRITIQUE : Eliminer les Waterfalls

```tsx
// INTERDIT : await sequentiel
const user = await fetchUser();
const posts = await fetchPosts();

// OBLIGATOIRE : paralleliser les operations independantes
const [user, posts] = await Promise.all([fetchUser(), fetchPosts()]);
```

- Deplacer les `await` dans les branches ou ils sont utilises
- Utiliser `<Suspense>` pour streamer le contenu progressivement
- Ne jamais bloquer le rendu avec des operations sequentielles

### CRITIQUE : Optimiser la Taille du Bundle

```tsx
// INTERDIT : barrel imports
import { Check } from 'lucide-react';

// OBLIGATOIRE : import direct
import Check from 'lucide-react/dist/esm/icons/check';
```

- Utiliser `next/dynamic` ou `React.lazy` pour les composants lourds
- Charger analytics/tracking APRES l'hydratation
- Precharger les modules au hover/focus pour la vitesse percue

### HAUTE : Performance Server-Side

- `React.cache()` pour la deduplication par requete
- Cache LRU pour le cache cross-requetes
- Minimiser les donnees serialisees aux Client Components
- Restructurer les composants pour paralleliser les fetches

### MOYENNE-HAUTE : Data Fetching Client

- Utiliser SWR ou TanStack Query pour la deduplication automatique
- Dedupliquer les event listeners globaux

### MOYENNE : Optimisation des Re-renders

```tsx
// INTERDIT : calculer dans un useEffect
const [visibleTodos, setVisibleTodos] = useState([]);
useEffect(() => {
  setVisibleTodos(todos.filter(t => !t.completed));
}, [todos]);

// OBLIGATOIRE : calculer pendant le render
const visibleTodos = todos.filter(t => !t.completed);

// OU useMemo pour les calculs couteux
const sortedData = useMemo(() => {
  return [...data].sort((a, b) => a.name.localeCompare(b.name));
}, [data]);
```

- Ne pas s'abonner a un state utilise seulement dans les callbacks
- Utiliser `useMemo` pour les calculs couteux, pas pour tout
- `useCallback` uniquement quand necessaire (composant enfant memoize)
- Utiliser `startTransition` pour les updates non-urgentes
- Lazy state initialization : `useState(() => computeExpensiveValue())`

---

## Architecture des Composants

### Composition > Boolean Props

```tsx
// INTERDIT : accumulation de boolean props
<Card isCompact isHighlighted showBorder />

// OBLIGATOIRE : composition
<Card>
  <Card.Header highlighted />
  <Card.Body compact />
</Card>
```

### Compound Components

- Utiliser le Context pour partager l'etat entre sous-composants
- Definir une interface generique : `state`, `actions`, `meta`
- Le Provider est le seul a connaitre l'implementation du state

### Props et Children

```tsx
interface ButtonProps {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  children: React.ReactNode;
}
```

### Composants Generiques

```tsx
interface ListProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
}

function List<T>({ items, renderItem }: ListProps<T>) {
  return <ul>{items.map((item, i) => <li key={i}>{renderItem(item)}</li>)}</ul>;
}
```

---

## TypeScript - Regles

- **strict mode** obligatoire
- Definir les types pour tous les props, states, et event handlers
- Utiliser `React.FormEvent`, `React.ChangeEvent`, etc.
- Typer les navigation params (`ParamList`)
- Preferer `interface` pour les props, `type` pour les unions

```tsx
const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
};

const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  console.log(e.target.value);
};
```

---

## Custom Hooks - Patterns

- Extraire la logique reutilisable dans des hooks custom
- Nommer avec le prefixe `use`
- Un hook = une responsabilite

```tsx
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  return isOnline;
}
```

---

## Rendering - Regles

| Pattern | Regle |
|---------|-------|
| Conditional rendering | Utiliser ternaire, pas `&&` (evite les `0` affiches) |
| Listes longues | `content-visibility: auto` en CSS |
| SVG | Animer le wrapper `<div>`, pas le `<svg>` |
| JSX statique | Hoister hors du composant |
| Hydration mismatch | Utiliser inline script pour les donnees client-only |
| Show/Hide | Utiliser `<Activity>` (React 19) au lieu de mount/unmount |

---

## JavaScript - Micro-Optimisations (hot paths)

- Grouper les changements CSS via classes ou `cssText`
- Construire des `Map` pour les lookups repetes
- Cacher les acces aux proprietes d'objets dans les boucles
- `Set`/`Map` pour les lookups O(1)
- `toSorted()` au lieu de `sort()` (immutabilite)
- Early return dans les fonctions
- Hoister les `RegExp` hors des boucles
- Verifier `.length` avant une comparaison couteuse

---

## React Compiler (React 19+)

- Ecrire du code React idiomatique standard
- **Supprimer** les `useMemo`, `useCallback`, `memo` manuels
- Le compilateur optimise automatiquement
- Garder les composants purs (pas d'effets de bord dans le render)

```bash
npm install -D babel-plugin-react-compiler@latest
```

---

## Testing

- React Testing Library pour les tests unitaires/integration
- Tester le comportement utilisateur, pas l'implementation
- Mocker les Server Actions dans les tests
- Verifier les etats : loading, error, success, empty

---

## Accessibility

- WCAG 2.1 AA minimum
- Tester avec `accessibility-specialist` agent
- Utiliser des roles ARIA semantiques
- Assurer la navigation clavier complete
- Tester avec lecteur d'ecran (VoiceOver, NVDA)

---

## Metriques a Suivre

| Metrique | Description | Objectif |
|----------|-------------|----------|
| LCP | Largest Contentful Paint | < 2.5s |
| FID/INP | First Input Delay / Interaction to Next Paint | < 100ms |
| CLS | Cumulative Layout Shift | < 0.1 |
| TTI | Time to Interactive | < 3.5s |
| Bundle size | Taille JS initiale | Minimiser |
| TTFB | Time to First Byte | < 800ms |

---

## Anti-Patterns (INTERDIT)

| Anti-Pattern | Correction |
|-------------|------------|
| `useEffect` pour du state derive | Calculer pendant le render |
| Mutation directe du state | Creer une nouvelle reference |
| `sort()` sur un array existant | `toSorted()` ou spread + sort |
| Barrel imports de grandes libs | Import direct du fichier source |
| `await` sequentiel independant | `Promise.all()` |
| `key={index}` dans les listes | `key={item.id}` stable |
| `window` dans un Server Component | Deplacer dans un Client Component |
| `useEffect` dependencies manquantes | Inclure toutes les dependencies |
| Boolean props accumules | Composition / Compound Components |
