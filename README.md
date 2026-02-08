# DCM - Distributed Context Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1.svg)](https://bun.sh)
[![PostgreSQL 16](https://img.shields.io/badge/database-PostgreSQL%2016-336791.svg)](https://www.postgresql.org/)

**Persistent context, compact recovery, and cross-agent sharing for Claude Code multi-agent sessions.**

---

## What is DCM?

DCM (Distributed Context Manager) is a backend service that gives Claude Code sessions persistent memory. When Claude Code runs multi-agent workflows, each agent operates in isolation with a finite context window. DCM solves this by tracking every tool call, saving context snapshots before compaction, restoring them afterward, and sharing results across agents in real time.

DCM integrates with Claude Code through its hooks system. Lightweight bash scripts fire on key lifecycle events -- session start, tool use, agent completion, compaction -- and report to a local API backed by PostgreSQL. When Claude's context window fills up and the conversation compacts, DCM injects a context brief so the session picks up where it left off without losing track of active tasks, modified files, or key decisions.

The system consists of three services: a REST API for tracking and context management, a WebSocket server for real-time event streaming, and a Next.js dashboard for monitoring. All three can be started with a single command, or auto-launched when Claude Code starts via the plugin system.

## Key Features

- **Compact save/restore** -- Automatically saves context snapshots before compaction and restores them afterward, so sessions never lose track of work in progress
- **Cross-agent sharing** -- When a subagent finishes, its result is broadcast so other agents can access it through the context API
- **Proactive monitoring** -- Monitors transcript size every 10th tool call and triggers early snapshots when nearing the context limit
- **Real-time event streaming** -- WebSocket server with LISTEN/NOTIFY bridge for live activity feeds
- **Tool and session tracking** -- Records every tool invocation, agent delegation, and session lifecycle event
- **Routing intelligence** -- Keyword-based tool suggestion with feedback-driven weight adjustment
- **Inter-agent messaging** -- Pub/sub messaging system for agent coordination
- **Auto-start services** -- In both CLI and plugin mode, DCM auto-launches when Claude Code starts a session
- **Monitoring dashboard** -- Next.js UI with live activity feeds, session timelines, agent statistics, and tool analytics

## Architecture Overview

```mermaid
graph TD
    %% Styling
    classDef db fill:#336791,stroke:#fff,stroke-width:2px,color:#fff;
    classDef service fill:#ff9f43,stroke:#333,stroke-width:1px,color:#fff;
    classDef client fill:#f1f2f6,stroke:#333,stroke-width:1px,color:#333;

    subgraph Database ["Persistence Layer"]
        PG[("PostgreSQL 16<br/>claude_context<br/>(10 tables)")]:::db
    end

    subgraph Bridge ["LISTEN/NOTIFY Bridge"]
        API[("DCM API<br/>Bun + Hono<br/>Port 3847")]:::service
        WS[("DCM WebSocket<br/>Bun + Native<br/>Port 3849")]:::service
        Dash[("DCM Dashboard<br/>Next.js 16<br/>Port 3848")]:::service
    end

    subgraph Clients ["Input Sources"]
        Hooks[/"Hooks (Bash)"/]:::client
        SDK[/"SDK (TS)"/]:::client
        CLI[/"cURL"/]:::client
    end

    %% Connections
    Hooks --> API
    SDK --> API
    CLI --> API

    API <--> PG
    WS <--> PG
    Dash <--> PG
    
    API -.-> WS
