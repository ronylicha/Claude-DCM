# Context Dashboard

Real-time monitoring dashboard for the Distributed Context Manager (DCM). Provides visibility into sessions, agents, tools, messages, and context usage across multi-agent workflows.

## Stack

| Technology | Version | Role |
|------------|---------|------|
| Next.js | 16 | App Router framework |
| React | 19 | UI rendering |
| TypeScript | 5 | Type safety |
| Tailwind CSS | 4 | Utility-first styling |
| Recharts | 3 | Charts and visualizations |
| TanStack Query | 5 | Data fetching and caching |
| shadcn/ui | - | Component library (Radix-based) |

## Prerequisites

- **Node.js 20+** (or Bun 1.0+)
- **DCM API** running on port 3847
- **DCM WebSocket** running on port 3849

## Quick Start

```bash
cd context-dashboard
npm install
npm run dev
```

Open [http://localhost:3848](http://localhost:3848).

## Pages

| Route | Description |
|-------|-------------|
| `/` | Redirects to dashboard |
| `/dashboard` | Overview with KPIs and charts |
| `/sessions` | Active and past sessions |
| `/sessions/[id]` | Session detail view |
| `/projects` | Tracked projects |
| `/projects/[id]` | Project detail view |
| `/agents` | Registered agents and activity |
| `/agents/[id]` | Agent detail view |
| `/tools` | Tool usage statistics |
| `/routing` | Intelligent routing rules |
| `/messages` | Inter-agent messages (pub/sub) |
| `/context` | Context inspection |
| `/live` | Real-time WebSocket feed |

## Configuration

Create a `.env.local` file at the project root:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:3847
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3849
```

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | DCM API base URL | `http://127.0.0.1:3847` |
| `NEXT_PUBLIC_WS_URL` | DCM WebSocket URL | `ws://127.0.0.1:3849` |

## Development

```bash
npm run dev       # Start dev server on port 3848
npm run build     # Production build
npm run start     # Start production server
npm run lint      # Run ESLint
```

## License

All rights reserved.
