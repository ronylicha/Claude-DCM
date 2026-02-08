# Context Dashboard

Interface de monitoring temps réel pour le Distributed Context Manager (DCM). Visualisation des sessions, agents, outils et métriques de performance.

## Stack technique

| Technologie | Version | Usage |
|-------------|---------|-------|
| Next.js | 16.x | Framework React avec App Router |
| React | 19.x | UI Components |
| TypeScript | 5.x | Typage statique |
| TanStack Query | 5.x | Data fetching et cache |
| Tailwind CSS | 4.x | Styling utility-first |
| shadcn/ui | latest | Composants UI (Radix) |
| Recharts | 3.x | Graphiques et visualisations |
| Lucide React | latest | Icônes |

## Prérequis

- **Bun** >= 1.0.0 ou **Node.js** >= 18
- **Context Manager API** en cours d'exécution (port 3847)
- **Context Manager WebSocket** en cours d'exécution (port 3849)

## Installation

```bash
# Naviguer vers le répertoire
cd ~/.claude/services/context-dashboard

# Installer les dépendances
bun install
# ou
npm install
```

## Configuration

Créer un fichier `.env.local` :

```env
# URL de l'API Context Manager
NEXT_PUBLIC_API_URL=http://127.0.0.1:3847

# URL du WebSocket (optionnel, pour les updates temps réel)
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3849
```

## Démarrage

```bash
# Mode développement (port 3848)
bun run dev
# ou
npm run dev

# Build production
bun run build

# Démarrer en production
bun run start
```

Ouvrir http://localhost:3848 dans le navigateur.

## Pages disponibles

| Page | Route | Description |
|------|-------|-------------|
| Accueil | `/` | Redirection vers dashboard |
| Dashboard | `/dashboard` | Vue d'ensemble avec KPIs et graphiques |
| Sessions | `/sessions` | Liste des sessions actives et passées |
| Projects | `/projects` | Projets suivis par le DCM |
| Agents | `/agents` | Agents disponibles et leur activité |
| Tools | `/tools` | Outils (skills, commands, plugins) et usage |
| Routing | `/routing` | Règles de routage intelligent |
| Messages | `/messages` | Messages inter-agents (pub/sub) |
| Live | `/live` | Vue temps réel avec WebSocket |

## Composants Charts

Les composants de visualisation se trouvent dans `src/components/charts/` :

### KPICard

Carte avec indicateur clé de performance.

```tsx
import { KPICard } from '@/components/charts';

<KPICard
  title="Sessions actives"
  value={42}
  icon={Activity}
  trend={{ value: 12, isPositive: true }}
  description="vs. hier"
/>
```

### LineChart

Graphique linéaire pour les tendances.

```tsx
import { LineChart } from '@/components/charts';

<LineChart
  data={[
    { date: '2024-01', value: 100 },
    { date: '2024-02', value: 150 },
  ]}
  xKey="date"
  yKey="value"
  title="Évolution mensuelle"
/>
```

### BarChart

Graphique en barres pour les comparaisons.

```tsx
import { BarChart } from '@/components/charts';

<BarChart
  data={[
    { name: 'Edit', count: 450 },
    { name: 'Read', count: 380 },
  ]}
  xKey="name"
  yKey="count"
  title="Utilisation des outils"
/>
```

### PieChart

Graphique circulaire pour les répartitions.

```tsx
import { PieChart } from '@/components/charts';

<PieChart
  data={[
    { name: 'Completed', value: 75 },
    { name: 'In Progress', value: 20 },
    { name: 'Failed', value: 5 },
  ]}
  title="Statut des tâches"
/>
```

### AreaChart

Graphique en aires pour les volumes cumulés.

```tsx
import { AreaChart } from '@/components/charts';

<AreaChart
  data={timeSeriesData}
  xKey="timestamp"
  yKey="count"
  title="Activité sur 24h"
/>
```

## Composants Filters

Filtres réutilisables dans `src/components/filters/` :

```tsx
import { DateRangeFilter, AgentFilter, StatusFilter } from '@/components/filters';

// Filtre par date
<DateRangeFilter
  value={{ from: startDate, to: endDate }}
  onChange={setDateRange}
/>

// Filtre par agent
<AgentFilter
  agents={['backend-laravel', 'frontend-react']}
  selected={selectedAgents}
  onChange={setSelectedAgents}
/>

// Filtre par statut
<StatusFilter
  statuses={['pending', 'running', 'completed', 'failed']}
  selected={selectedStatuses}
  onChange={setSelectedStatuses}
/>
```

## Hooks et API Client

### API Client

Le client API se trouve dans `src/lib/api-client.ts` :

```tsx
import { apiClient } from '@/lib/api-client';

// Health check
const health = await apiClient.getHealth();

// Statistiques
const stats = await apiClient.getStats();

// Projects
const projects = await apiClient.getProjects(page, limit);

// Sessions
const sessions = await apiClient.getSessions(page, limit);

// Agents
const agents = await apiClient.getAgents();

// Tools
const tools = await apiClient.getTools();

// Messages
const messages = await apiClient.getMessages(sessionId);
```

### TanStack Query

Les queries sont configurées dans `src/providers/query-provider.tsx` :

```tsx
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// Exemple d'utilisation
function Dashboard() {
  const { data: health, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: apiClient.getHealth,
    refetchInterval: 30000, // Refresh toutes les 30s
  });

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: apiClient.getStats,
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      <KPICard title="Status" value={health.status} />
    </div>
  );
}
```

## WebSocket (Page Live)

La page `/live` utilise une connexion WebSocket pour les mises à jour temps réel :

```tsx
// Hook personnalisé pour WebSocket
function useWebSocket(url: string) {
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(url);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setMessages((prev) => [...prev, data]);
    };

    return () => ws.close();
  }, [url]);

  return { messages, connected };
}
```

## Export de données

Le composant `ExportButton` permet d'exporter les données :

```tsx
import { ExportButton } from '@/components/ExportButton';

<ExportButton
  data={sessions}
  filename="sessions-export"
  format="csv" // ou "json"
/>
```

L'utilitaire d'export se trouve dans `src/lib/export.ts`.

## Structure des fichiers

```
context-dashboard/
├── src/
│   ├── app/                    # Pages Next.js (App Router)
│   │   ├── layout.tsx          # Layout principal
│   │   ├── page.tsx            # Page d'accueil
│   │   ├── dashboard/
│   │   │   └── page.tsx
│   │   ├── sessions/
│   │   │   └── page.tsx
│   │   ├── projects/
│   │   │   └── page.tsx
│   │   ├── agents/
│   │   │   └── page.tsx
│   │   ├── tools/
│   │   │   └── page.tsx
│   │   ├── routing/
│   │   │   └── page.tsx
│   │   ├── messages/
│   │   │   └── page.tsx
│   │   └── live/
│   │       └── page.tsx
│   ├── components/
│   │   ├── charts/             # Composants graphiques
│   │   │   ├── index.ts
│   │   │   ├── KPICard.tsx
│   │   │   ├── LineChart.tsx
│   │   │   ├── BarChart.tsx
│   │   │   ├── PieChart.tsx
│   │   │   └── AreaChart.tsx
│   │   ├── filters/            # Composants de filtrage
│   │   │   ├── index.ts
│   │   │   ├── DateRangeFilter.tsx
│   │   │   ├── AgentFilter.tsx
│   │   │   └── StatusFilter.tsx
│   │   ├── ui/                 # Composants shadcn/ui
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── table.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── separator.tsx
│   │   │   └── skeleton.tsx
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   ├── PageContainer.tsx
│   │   ├── LoadingSpinner.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── ExportButton.tsx
│   │   ├── ThemeScript.tsx
│   │   └── index.ts
│   ├── lib/
│   │   ├── api-client.ts       # Client API
│   │   ├── query-client.ts     # Config TanStack Query
│   │   ├── utils.ts            # Utilitaires (cn, formatters)
│   │   └── export.ts           # Export CSV/JSON
│   └── providers/
│       └── query-provider.tsx  # Provider TanStack Query
├── public/
├── .env.local
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

## Personnalisation du thème

Le thème utilise Tailwind CSS avec des variables CSS. Modifier `src/app/globals.css` :

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 221.2 83.2% 53.3%;
  --secondary: 210 40% 96.1%;
  /* ... */
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... */
}
```

## Développement

```bash
# Lancer en mode développement avec hot reload
bun run dev

# Vérifier les types TypeScript
bun x tsc --noEmit

# Linter
bun run lint

# Build de production
bun run build
```

## Dépannage

### L'API ne répond pas

Vérifier que le Context Manager est démarré :

```bash
curl http://127.0.0.1:3847/health
```

### Les graphiques ne s'affichent pas

Vérifier que Recharts est correctement importé et que les données sont au bon format.

### WebSocket ne se connecte pas

Vérifier que le serveur WebSocket est démarré :

```bash
curl http://127.0.0.1:3849/health
```

## Licence

Projet interne - Tous droits réservés
