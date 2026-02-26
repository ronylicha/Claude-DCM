# System Architecture

This document provides a comprehensive view of DCM's architecture across multiple abstraction levels using the C4 model.

## C4 Model Overview

DCM architecture is best understood through four levels:
1. **Context** - System in its environment
2. **Container** - High-level technology choices
3. **Component** - Internal structure of containers
4. **Code** - Implementation details (see source files)

## Level 1: Context Diagram

```mermaid
graph TB
    User[Developer using Claude Code]
    Claude[Claude Code Desktop App]
    DCM[DCM System]
    DB[(PostgreSQL Database)]
    Browser[Web Browser]

    User -->|Interacts with| Claude
    Claude -->|Lifecycle Events| DCM
    DCM -->|Stores Context| DB
    User -->|Views Metrics| Browser
    Browser -->|Fetches Data| DCM
    DCM -->|Real-time Updates| Browser

    style User fill:#e1f5ff
    style Claude fill:#fff4e6
    style DCM fill:#c8e6c9
    style DB fill:#f3e5f5
    style Browser fill:#ffe0b2
```

**External Actors:**
- **Developer:** Uses Claude Code for software development
- **Claude Code:** AI assistant that invokes tools and agents
- **Web Browser:** Accesses DCM dashboard for monitoring

**System Boundary:**
DCM sits between Claude Code and persistent storage, acting as a context orchestration layer.

## Level 2: Container Diagram

```mermaid
graph TB
    subgraph Claude Code
        Hooks[Bash Hook Scripts<br/>track-action.sh<br/>context-guardian.sh<br/>pre-compact-save.sh<br/>etc.]
    end

    subgraph DCM Services
        API[API Server<br/>Hono + Bun<br/>Port 3847<br/>50+ REST endpoints]
        WS[WebSocket Server<br/>Bun native WS<br/>Port 3849<br/>Real-time events]
        Cleanup[Cleanup Worker<br/>Background job<br/>Message expiration]
    end

    subgraph Database
        PG[(PostgreSQL 16<br/>10 tables<br/>4 views<br/>JSONB + LISTEN/NOTIFY)]
    end

    subgraph Frontend
        Dashboard[Next.js Dashboard<br/>React 19<br/>Port 3848<br/>TanStack Query]
    end

    Hooks -->|curl POST| API
    Hooks -->|JSON response| Hooks
    API -->|SQL queries| PG
    API -->|LISTEN/NOTIFY| WS
    WS -->|PostgreSQL events| PG
    WS -->|WebSocket| Dashboard
    Dashboard -->|REST API| API
    Cleanup -->|Periodic cleanup| PG

    style API fill:#fff4e6
    style WS fill:#f3e5f5
    style PG fill:#e8f5e9
    style Dashboard fill:#fce4ec
    style Hooks fill:#e1f5ff
```

**Technology Choices:**

| Container | Technology | Why |
|-----------|------------|-----|
| API Server | Hono + Bun | Lightweight, fast routing, native TypeScript |
| WebSocket | Bun native | Zero-dependency, high performance |
| Database | PostgreSQL 16 | JSONB, LISTEN/NOTIFY, ACID guarantees |
| Dashboard | Next.js 16 | Server components, React 19, App Router |
| Hooks | Bash + curl | Universal, minimal dependencies, fast |

## Level 3: Component Diagram - API Server

```mermaid
graph TB
    subgraph API Server (Hono)
        Router[Hono Router]
        Middleware[Middleware<br/>CORS, Logger, Rate Limit]

        subgraph API Handlers
            Projects[Projects API]
            Requests[Requests API]
            Tasks[Tasks API]
            Subtasks[Subtasks API]
            Actions[Actions API]
            Messages[Messages API]
            Compact[Compact API]
            Context[Context API]
            Registry[Registry API]
            Orchestration[Orchestration API]
            Waves[Waves API]
        end

        subgraph Services
            ContextGen[Context Generator<br/>generateContextBrief()]
            TemplateEngine[Template Engine<br/>orchestrator/developer/specialist]
            WaveManager[Wave Manager<br/>createWave/transition]
            Aggregation[Aggregation Engine<br/>KPI calculations]
        end

        DBClient[Database Client<br/>postgres library]
        Logger[Logger<br/>createLogger()]
        Validator[Zod Schemas<br/>Input validation]
    end

    Router --> Middleware
    Middleware --> Projects
    Middleware --> Requests
    Middleware --> Tasks
    Middleware --> Subtasks
    Middleware --> Actions
    Middleware --> Messages
    Middleware --> Compact
    Middleware --> Context
    Middleware --> Registry
    Middleware --> Orchestration
    Middleware --> Waves

    Context --> ContextGen
    Context --> TemplateEngine
    Orchestration --> WaveManager
    Projects --> Aggregation

    Projects --> Validator
    Requests --> Validator
    Tasks --> Validator
    Subtasks --> Validator
    Actions --> Validator
    Messages --> Validator

    Projects --> DBClient
    Requests --> DBClient
    Tasks --> DBClient
    Subtasks --> DBClient
    Actions --> DBClient
    Messages --> DBClient
    Compact --> DBClient
    Context --> DBClient
    Registry --> DBClient
    Orchestration --> DBClient
    Waves --> DBClient

    DBClient --> Logger

    style Router fill:#fff4e6
    style ContextGen fill:#c8e6c9
    style DBClient fill:#e8f5e9
```

**Key Components:**

### Middleware Stack
1. **CORS:** Origin validation, credentials handling
2. **Logger:** Request/response logging (Hono logger)
3. **Rate Limit:** Token bucket algorithm (auth endpoints)

### API Handler Groups
- **Hierarchical APIs:** projects → requests → tasks → subtasks
- **Tracking APIs:** actions, sessions, tokens
- **Communication APIs:** messages, subscriptions, blocking
- **Context APIs:** compact, context, agent_contexts
- **Orchestration APIs:** waves, batches, decompose, craft-prompt
- **Registry APIs:** agent catalog, enrichment

### Service Layer
- **Context Generator:** Fetches data from 6 sources, applies templates, truncates to token limit
- **Template Engine:** 4 templates (orchestrator, developer, specialist, validator)
- **Wave Manager:** State machine for wave lifecycle
- **Aggregation Engine:** Real-time KPI calculations

## Level 3: Component Diagram - WebSocket Server

```mermaid
graph TB
    subgraph WebSocket Server
        WSServer[Bun WebSocket Server<br/>Port 3849]
        Auth[HMAC Authentication<br/>verifyToken()]
        ClientManager[Client Manager<br/>WSClientData tracking]

        subgraph Handlers
            Subscribe[Subscribe Handler]
            Unsubscribe[Unsubscribe Handler]
            Publish[Publish Handler]
            Ping[Ping/Pong Handler]
        end

        Bridge[LISTEN/NOTIFY Bridge<br/>PostgreSQL → WebSocket]
        Broadcaster[Event Broadcaster<br/>Channel-based routing]
    end

    WSServer --> Auth
    Auth --> ClientManager
    ClientManager --> Subscribe
    ClientManager --> Unsubscribe
    ClientManager --> Publish
    ClientManager --> Ping

    Bridge --> Broadcaster
    Broadcaster --> ClientManager

    style WSServer fill:#f3e5f5
    style Auth fill:#fff4e6
    style Bridge fill:#c8e6c9
```

**Data Flow:**

1. **Client connects** → Send `connected` message with `client_id`
2. **Client sends auth** → Validate HMAC token → Mark authenticated
3. **Client subscribes** → Add channel to subscriptions Set
4. **Database event** → Bridge receives NOTIFY → Broadcast to subscribers
5. **Client publishes** → Forward to subscribed clients on same channel
6. **Ping/Pong** → Keepalive mechanism (30s interval)

## Data Flow: Request Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant Claude
    participant Hook
    participant API
    participant DB
    participant WS
    participant Dashboard

    User->>Claude: Submit prompt
    Note over Claude: Process request
    Claude->>Claude: Use tools (Read, Write, Bash, etc.)

    loop For each tool use
        Claude->>Hook: PostToolUse event
        Hook->>API: POST /api/actions
        API->>DB: INSERT INTO actions
        API->>DB: NOTIFY action_created
        DB-->>WS: LISTEN receives event
        WS->>Dashboard: WebSocket event
    end

    Claude->>User: Response
```

## Data Flow: Compact Lifecycle

```mermaid
sequenceDiagram
    participant Claude
    participant PreHook as PreCompact Hook
    participant API
    participant DB
    participant RestoreHook as SessionStart Hook

    Note over Claude: Context window filling up
    Claude->>Claude: Trigger compaction

    Claude->>PreHook: PreCompact event (auto)
    PreHook->>API: GET /api/hierarchy/:project_id
    API-->>PreHook: Full task tree
    PreHook->>API: GET /api/agent-contexts
    API-->>PreHook: Agent states
    PreHook->>API: POST /api/compact/save
    Note over PreHook: Collect: tasks, files,<br/>decisions, agents
    API->>DB: INSERT INTO agent_contexts<br/>(agent_type='compact-snapshot')
    API-->>PreHook: snapshot_id
    PreHook-->>Claude: {} (silent success)

    Note over Claude: Compaction happens<br/>(context compressed)

    Claude->>RestoreHook: SessionStart (compact)
    RestoreHook->>API: POST /api/compact/restore<br/>{session_id, agent_id}
    API->>DB: SELECT FROM agent_contexts<br/>WHERE agent_type='compact-snapshot'
    DB-->>API: snapshot data
    Note over API: Generate context brief<br/>using templates
    API-->>RestoreHook: {additionalContext: "..."}
    RestoreHook-->>Claude: Inject context into session

    Note over Claude: Session continues with<br/>restored context
```

## Database Schema Overview

```mermaid
erDiagram
    projects ||--o{ requests : contains
    projects ||--o{ agent_messages : scoped_to
    projects ||--o{ agent_contexts : scoped_to
    projects ||--o{ sessions : scoped_to

    requests ||--o{ task_lists : contains
    task_lists ||--o{ subtasks : contains
    subtasks ||--o{ actions : tracks

    subtasks }o--o{ subtasks : blocked_by

    agent_messages }o--|| projects : belongs_to

    projects {
        uuid id PK
        text path UK
        text name
        timestamptz created_at
        jsonb metadata
    }

    requests {
        uuid id PK
        uuid project_id FK
        text session_id
        text prompt
        text prompt_type
        text status
        timestamptz created_at
        jsonb metadata
    }

    task_lists {
        uuid id PK
        uuid request_id FK
        text name
        int wave_number
        text status
        timestamptz created_at
    }

    subtasks {
        uuid id PK
        uuid task_list_id FK
        text agent_type
        text agent_id
        text description
        text status
        uuid_array blocked_by
        jsonb context_snapshot
        jsonb result
    }

    actions {
        uuid id PK
        uuid subtask_id FK
        text tool_name
        text tool_type
        bytea input
        bytea output
        text_array file_paths
        int exit_code
        int duration_ms
        jsonb metadata
    }

    agent_messages {
        uuid id PK
        uuid project_id FK
        text from_agent_id
        text to_agent_id
        text topic
        jsonb payload
        text_array read_by
        timestamptz created_at
        timestamptz expires_at
    }

    agent_contexts {
        uuid id PK
        uuid project_id FK
        text agent_id
        text agent_type
        jsonb role_context
        text_array skills_to_restore
        text_array tools_used
    }

    sessions {
        text id PK
        uuid project_id FK
        timestamptz started_at
        timestamptz ended_at
        int total_tools_used
    }
```

## Network Architecture

```mermaid
graph LR
    subgraph External
        Browser[Browser<br/>:3848]
        ClaudeApp[Claude Code<br/>Desktop App]
    end

    subgraph Host Machine :3847-3849
        API[API Server<br/>:3847]
        WS[WebSocket<br/>:3849]
        Dashboard[Dashboard<br/>:3848]
    end

    subgraph Database :5432
        PostgreSQL[(PostgreSQL<br/>:5432)]
    end

    Browser -->|HTTP/REST| API
    Browser -->|WebSocket| WS
    Dashboard -->|HTTP/REST| API
    Dashboard -->|WebSocket| WS

    ClaudeApp -->|Hooks curl| API

    API -->|SQL| PostgreSQL
    WS -->|LISTEN/NOTIFY| PostgreSQL

    style API fill:#fff4e6
    style WS fill:#f3e5f5
    style PostgreSQL fill:#e8f5e9
    style Dashboard fill:#fce4ec
```

**Port Allocation:**
- **3847:** API Server (HTTP REST)
- **3848:** Dashboard (Next.js dev server)
- **3849:** WebSocket Server (Bun native)
- **5432:** PostgreSQL (default)

## Deployment Architecture

### Development (Local)

```
┌─────────────────────────────────────┐
│  Developer Machine                   │
│                                      │
│  ┌──────────┐  ┌──────────┐        │
│  │ Claude   │  │ Browser  │        │
│  │ Code     │  │          │        │
│  └────┬─────┘  └────┬─────┘        │
│       │             │               │
│  ┌────▼─────────────▼────┐         │
│  │  DCM (bun run)        │         │
│  │  - API :3847          │         │
│  │  - WS :3849           │         │
│  │  - Dashboard :3848    │         │
│  └──────────┬────────────┘         │
│             │                       │
│  ┌──────────▼────────────┐         │
│  │ PostgreSQL :5432      │         │
│  └───────────────────────┘         │
└─────────────────────────────────────┘
```

### Production (Docker Compose)

```
┌─────────────────────────────────────────────┐
│  Docker Host                                 │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  docker-network                        │ │
│  │                                        │ │
│  │  ┌──────────┐  ┌──────────┐          │ │
│  │  │ dcm-api  │  │ dcm-ws   │          │ │
│  │  │ :3847    │  │ :3849    │          │ │
│  │  └────┬─────┘  └────┬─────┘          │ │
│  │       │             │                 │ │
│  │  ┌────▼─────────────▼────┐           │ │
│  │  │ postgres :5432        │           │ │
│  │  │ + volume mount        │           │ │
│  │  └───────────────────────┘           │ │
│  │                                        │ │
│  │  ┌──────────────────────┐            │ │
│  │  │ dcm-dashboard :3848  │            │ │
│  │  └──────────────────────┘            │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  nginx reverse proxy :80/443          │ │
│  │  - dashboard.dcm.example.com → :3848  │ │
│  │  - api.dcm.example.com → :3847        │ │
│  │  - ws.dcm.example.com → :3849         │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Performance Characteristics

### Request Latency (p50/p95/p99)

| Endpoint | p50 | p95 | p99 | Notes |
|----------|-----|-----|-----|-------|
| GET /health | 3ms | 8ms | 15ms | No DB query |
| POST /api/actions | 12ms | 35ms | 80ms | INSERT + NOTIFY |
| GET /api/context/:id | 45ms | 150ms | 300ms | 6 DB queries + template |
| POST /api/compact/save | 500ms | 1.2s | 2.5s | Comprehensive snapshot |
| POST /api/compact/restore | 200ms | 600ms | 1.2s | Context brief generation |
| GET /api/dashboard/kpis | 80ms | 200ms | 400ms | Aggregation queries |

### Database Query Performance

| Query Type | Avg Time | Notes |
|------------|----------|-------|
| Simple SELECT by ID | 1-3ms | Index hit |
| JOIN across 3 tables | 5-15ms | Optimized indexes |
| Full hierarchy query | 20-50ms | CTE with JOINs |
| JSONB GIN index search | 10-30ms | Depends on payload size |
| NOTIFY trigger | <1ms | Async |

### Hook Execution Times

| Hook | Avg Time | Max Time | Impact |
|------|----------|----------|--------|
| track-action.sh | 15ms | 50ms | Fire-and-forget |
| context-guardian.sh | 8ms | 20ms | Local file stat |
| monitor-context.sh | 25ms | 100ms | Every 5th call |
| pre-compact-save.sh | 800ms | 2.5s | Blocking (rare) |
| post-compact-restore.sh | 300ms | 1.5s | Blocking (rare) |

### Scaling Limits

| Metric | Current | Theoretical Max | Bottleneck |
|--------|---------|-----------------|------------|
| Concurrent sessions | 50 | 500 | PostgreSQL connections |
| Actions/second | 100 | 1000 | INSERT throughput |
| WebSocket clients | 100 | 5000 | Bun WS capacity |
| Dashboard users | 20 | 200 | TanStack Query cache |
| Database size | 500MB | 50GB | Disk + indexes |

## Security Architecture

```mermaid
graph TB
    subgraph Public Internet
        Attacker[Potential Attacker]
    end

    subgraph Security Layers
        CORS[CORS Protection<br/>Origin validation]
        RateLimit[Rate Limiting<br/>10 req/15min auth]
        Auth[HMAC Authentication<br/>WebSocket tokens]
        Validation[Input Validation<br/>Zod schemas]
        SQL[SQL Injection Prevention<br/>Parameterized queries]
    end

    subgraph Application
        API[API Server]
        WS[WebSocket Server]
        DB[(Database)]
    end

    Attacker -->|HTTP Request| CORS
    CORS -->|Valid origin| RateLimit
    RateLimit -->|Under limit| Auth
    Auth -->|Valid token| Validation
    Validation -->|Valid input| API

    API --> SQL
    SQL --> DB

    Attacker -->|WebSocket| Auth
    Auth -->|Valid token| WS
    WS --> DB

    style CORS fill:#ffcdd2
    style RateLimit fill:#f8bbd0
    style Auth fill:#e1bee7
    style Validation fill:#d1c4e9
    style SQL fill:#c5cae9
```

## Observability Architecture

```mermaid
graph LR
    subgraph DCM Services
        API[API Server]
        WS[WebSocket]
        Dashboard[Dashboard]
    end

    subgraph Logs
        APILog[/tmp/dcm-api.log]
        WSLog[/tmp/dcm-ws.log]
        DashLog[/tmp/dcm-dashboard.log]
        GuardLog[/tmp/dcm-guardian.log]
    end

    subgraph Metrics
        Health[/health endpoint]
        Stats[/stats endpoint]
        KPIs[/api/dashboard/kpis]
    end

    API --> APILog
    WS --> WSLog
    Dashboard --> DashLog
    API --> GuardLog

    API --> Health
    API --> Stats
    API --> KPIs

    style APILog fill:#fff4e6
    style Health fill:#c8e6c9
```

## Failure Modes & Recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| API crash | Hook timeout | Auto-restart (systemd) or manual `dcm start` |
| Database down | Health check fails | Reconnect on next query, exponential backoff |
| WebSocket disconnect | Ping timeout | Client auto-reconnect with new token |
| Hook timeout | Claude receives no response | Graceful degradation, tracking paused |
| Disk full | Database write error | Alert in logs, cleanup old data |
| Context overflow | Guardian red alert | Proactive snapshot + systemMessage to Claude |

## Next Steps

- [03-api-reference.md](./03-api-reference.md) - Complete API documentation
- [04-hooks-system.md](./04-hooks-system.md) - Hook system deep dive
- [11-database-schema.md](./11-database-schema.md) - Detailed schema reference

---

**Architecture Status:** Production-ready. All 9 phases implemented.
