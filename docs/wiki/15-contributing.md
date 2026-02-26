# Contributing to DCM

**Version:** 3.0.0
**Generated:** 2026-02-09
**Status:** Active Development

## Welcome Contributors

Thank you for your interest in contributing to DCM (Distributed Context Manager)! This guide will help you get started with development, testing, and submitting changes.

## Table of Contents

1. [Development Setup](#development-setup)
2. [Project Structure](#project-structure)
3. [Tech Stack](#tech-stack)
4. [Code Style](#code-style)
5. [Testing](#testing)
6. [Making Changes](#making-changes)
7. [Pull Request Process](#pull-request-process)
8. [Branch Naming](#branch-naming)
9. [Commit Guidelines](#commit-guidelines)
10. [Documentation](#documentation)

## Development Setup

### Prerequisites

- **Bun** ≥ 1.0.0 (https://bun.sh)
- **PostgreSQL** ≥ 16
- **Node.js** ≥ 18 (for dashboard only)
- **Git**
- **jq** (for hooks testing)

### Fork and Clone

```bash
# Fork repository on GitHub first

# Clone your fork
git clone https://github.com/YOUR_USERNAME/Claude-DCM.git
cd Claude-DCM
```

### Install Dependencies

```bash
# Backend (context-manager)
cd context-manager
bun install

# Frontend (context-dashboard)
cd ../context-dashboard
bun install
```

### Configure Environment

```bash
# Backend
cd context-manager
cp .env.example .env
nano .env  # Edit with your credentials

# Frontend
cd context-dashboard
cp .env.local.example .env.local
nano .env.local
```

### Setup Database

```bash
cd context-manager
./dcm db:setup
```

### Start Development Servers

```bash
# Terminal 1: API server
cd context-manager
bun run src/server.ts

# Terminal 2: WebSocket server
cd context-manager
bun run src/websocket-server.ts

# Terminal 3: Dashboard
cd context-dashboard
bun run dev
```

## Project Structure

```
Claude-DCM/
├── context-manager/          # Backend (Bun + Hono)
│   ├── src/
│   │   ├── server.ts         # Main API server
│   │   ├── websocket-server.ts
│   │   ├── config.ts         # Configuration
│   │   ├── api/              # Route handlers (22 files)
│   │   ├── db/               # Database client & schema
│   │   ├── websocket/        # WebSocket logic
│   │   ├── waves/            # Wave orchestration
│   │   ├── templates/        # Agent prompt templates
│   │   ├── lib/              # Utilities
│   │   └── tests/            # Test files
│   ├── hooks/                # Claude Code hooks (16 bash scripts)
│   ├── scripts/              # Setup scripts
│   ├── dcm                   # CLI script
│   └── package.json
│
├── context-dashboard/        # Frontend (Next.js 16)
│   ├── src/
│   │   ├── app/              # Next.js pages (18 routes)
│   │   ├── components/       # React components
│   │   ├── lib/              # API client, utilities
│   │   ├── hooks/            # React hooks
│   │   └── providers/        # Context providers
│   └── package.json
│
├── docs/                     # Documentation
│   ├── wiki/                 # Wiki pages (16 pages)
│   ├── API.md
│   ├── ARCHITECTURE.md
│   └── _codebase-analysis.md
│
└── README.md
```

## Tech Stack

### Backend (context-manager)

- **Runtime:** Bun (not Node.js)
- **HTTP Framework:** Hono v4
- **Database:** PostgreSQL 16 with JSONB
- **Validation:** Zod v4
- **WebSocket:** Bun native (no external library)
- **Language:** TypeScript (strict mode)

**Key Libraries:**
- `hono@^4.11.7` - Fast HTTP routing
- `postgres@^3.4.8` - PostgreSQL driver
- `zod@^4.3.6` - Schema validation

### Frontend (context-dashboard)

- **Framework:** Next.js 16 (App Router)
- **UI:** React 19
- **Styling:** Tailwind CSS v4
- **Components:** shadcn/ui (Radix UI)
- **Charts:** Recharts v3
- **Data:** TanStack Query v5
- **Icons:** Lucide React

### Testing

- **Test Runner:** `bun test`
- **Framework:** Bun's built-in test framework
- **No Jest or Vitest** - Bun includes testing natively

## Code Style

### TypeScript Guidelines

**Strict Mode:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

**Naming Conventions:**
- **Files:** `kebab-case.ts`
- **Functions:** `camelCase`
- **Types/Interfaces:** `PascalCase`
- **Constants:** `UPPER_SNAKE_CASE`

**Example:**
```typescript
// Good
interface AgentContext {
  agentId: string;
  sessionId: string;
}

export async function getAgentContext(id: string): Promise<AgentContext> {
  const API_URL = "http://localhost:3847";
  // ...
}

// Bad
interface agent_context {
  AgentID: string;
  session_id: string;
}
```

### API Handler Pattern

All API handlers follow this structure:

```typescript
import type { Context } from "hono";
import { z } from "zod";
import { getDb } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("ModuleName");

// Zod schema for validation
const InputSchema = z.object({
  field: z.string().min(1, "field is required"),
});

type Input = z.infer<typeof InputSchema>;

export async function postHandler(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();

    // Validate input
    const parseResult = InputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const input: Input = parseResult.data;
    const sql = getDb();

    // Database operation
    const results = await sql`
      SELECT * FROM table WHERE field = ${input.field}
    `;

    // Return response
    return c.json({ data: results });
  } catch (error) {
    log.error("Handler error:", error);
    return c.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
```

### React Component Pattern

```typescript
"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { apiClient } from "@/lib/api-client";

interface Props {
  sessionId: string;
}

export default function MyComponent({ sessionId }: Props) {
  const [data, setData] = useState<DataType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await apiClient.getData(sessionId);
        setData(result);
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [sessionId]);

  if (loading) return <div>Loading...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Title</CardTitle>
      </CardHeader>
      <CardContent>
        {data.map((item) => (
          <div key={item.id}>{item.name}</div>
        ))}
      </CardContent>
    </Card>
  );
}
```

### Bash Script Style

```bash
#!/usr/bin/env bash
# Script description
set -euo pipefail

# Constants
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"

# Functions
function main() {
  # Logic here
  echo "Done"
}

# Entry point
main "$@"
```

## Testing

### Backend Tests

**Location:** `context-manager/src/tests/`

**Run all tests:**
```bash
cd context-manager
bun test
```

**Run specific test:**
```bash
bun test src/tests/api.test.ts
```

**Example Test:**
```typescript
import { test, expect, describe } from "bun:test";
import { getDb } from "../db/client";

describe("API Tests", () => {
  test("POST /api/sessions creates session", async () => {
    const response = await fetch("http://localhost:3847/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "test-session",
        started_at: new Date().toISOString(),
      }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toBe("test-session");
  });
});
```

### Hook Tests

**Test bash scripts:**
```bash
# Syntax check
bash -n hooks/track-action.sh

# Manual test
echo '{"tool_name":"Bash","session_id":"test"}' | bash hooks/track-action.sh
```

### Integration Tests

```bash
# Full system test
./dcm stop
./dcm db:reset
./dcm start
sleep 3
curl http://localhost:3847/health | jq .
```

## Making Changes

### 1. Create Feature Branch

```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

### 2. Make Changes

- Follow code style guidelines
- Add tests for new features
- Update documentation if needed

### 3. Test Locally

```bash
# Run tests
cd context-manager
bun test

# Lint (if configured)
bun run lint

# Type check
tsc --noEmit
```

### 4. Commit Changes

```bash
git add .
git commit -m "feat: add new feature"
```

See [Commit Guidelines](#commit-guidelines) below.

### 5. Push to Fork

```bash
git push origin feature/your-feature-name
```

## Pull Request Process

### 1. Create Pull Request

- Go to GitHub and create PR from your fork
- Fill out PR template
- Link related issues

### 2. PR Title Format

```
<type>(<scope>): <description>

Examples:
feat(api): add batch orchestration endpoint
fix(hooks): resolve compact restore timeout
docs(wiki): add troubleshooting guide
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code refactoring
- `test` - Add/update tests
- `chore` - Maintenance tasks

**Scopes:**
- `api` - Backend API
- `websocket` - WebSocket server
- `dashboard` - Frontend
- `hooks` - Claude Code hooks
- `cli` - CLI commands
- `db` - Database schema

### 3. PR Description Template

```markdown
## Description
Brief description of changes.

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Testing
Describe testing performed:
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] No console.log statements (except in debug utilities)
```

### 4. Review Process

1. **Automated Checks:** CI runs tests automatically
2. **Code Review:** Maintainers review code
3. **Feedback:** Address review comments
4. **Approval:** Minimum 1 approval required
5. **Merge:** Maintainer merges PR

## Branch Naming

```
<type>/<short-description>

Examples:
feature/wave-orchestration
fix/compact-restore-bug
docs/api-reference-update
refactor/database-client
```

**Types:**
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation
- `refactor/` - Code refactoring
- `test/` - Testing improvements
- `chore/` - Maintenance

## Commit Guidelines

### Conventional Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Examples

```bash
# Simple commit
git commit -m "feat(api): add batch submit endpoint"

# With body
git commit -m "fix(hooks): resolve timeout issue

The track-action hook was timing out due to long API response.
Increased timeout from 3s to 5s and added retry logic."

# Breaking change
git commit -m "feat(db)!: migrate to PostgreSQL

BREAKING CHANGE: SQLite is no longer supported.
Database must be migrated to PostgreSQL 16+."
```

### Commit Messages

**Do:**
- Use imperative mood ("add" not "added")
- Be concise but descriptive
- Reference issue numbers

**Don't:**
- Use vague messages ("fix stuff", "update")
- Commit WIP (work in progress) to main
- Include unrelated changes

## Documentation

### Update Documentation When

- Adding new API endpoints
- Changing configuration options
- Adding new hooks
- Modifying database schema
- Changing CLI commands

### Documentation Locations

| Change | Update |
|--------|--------|
| API endpoint | `docs/wiki/03-api-reference.md` |
| Hook | `docs/wiki/04-hooks-system.md` |
| Configuration | `docs/wiki/13-configuration.md` |
| CLI command | `docs/wiki/12-cli-reference.md` |
| Architecture | `docs/wiki/02-architecture.md` |

### Documentation Style

- Use Markdown
- Include code examples
- Add Mermaid diagrams for flows
- Keep language professional and clear

## Development Workflow

### Daily Workflow

```bash
# 1. Start day
git checkout main
git pull origin main

# 2. Create branch
git checkout -b feature/new-feature

# 3. Develop
# ... make changes ...

# 4. Test
bun test

# 5. Commit
git add .
git commit -m "feat: add new feature"

# 6. Push
git push origin feature/new-feature

# 7. Create PR on GitHub
```

### Sync with Upstream

```bash
# Add upstream remote (once)
git remote add upstream https://github.com/ORIGINAL_OWNER/Claude-DCM.git

# Sync with upstream
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

## Code Review Guidelines

### As a Reviewer

- Be respectful and constructive
- Focus on code quality, not style (linter handles that)
- Ask questions if unclear
- Approve when satisfied

**Review Checklist:**
- [ ] Code follows project patterns
- [ ] Tests pass and cover new code
- [ ] Documentation updated
- [ ] No security issues
- [ ] No performance regressions
- [ ] Error handling present

### As an Author

- Respond to feedback promptly
- Don't take criticism personally
- Ask for clarification if needed
- Update PR based on feedback

## Release Process

**Maintainers only:**

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create git tag: `git tag v3.1.0`
4. Push tag: `git push origin v3.1.0`
5. Create GitHub release with notes

## Getting Help

### Questions

- Open a GitHub Discussion
- Tag issue with `question` label

### Bugs

- Search existing issues first
- Create new issue with bug template
- Include reproduction steps

### Feature Requests

- Create issue with feature template
- Describe use case and benefits

## Community

### Code of Conduct

- Be respectful and inclusive
- No harassment or discrimination
- Focus on constructive feedback
- Help newcomers

### Recognition

Contributors are recognized in:
- `README.md` contributors section
- Release notes
- GitHub contributor graph

## Development Tips

### Bun-Specific

```typescript
// Use Bun.file() instead of fs
const file = Bun.file("path/to/file");
const content = await file.text();

// Use Bun.$ for shell commands
import { $ } from "bun";
await $`ls -la`;

// WebSocket is built-in (no ws package)
const ws = new WebSocket("ws://localhost:3849");
```

### Database Queries

```typescript
// Use tagged template literals
const results = await sql`
  SELECT * FROM sessions
  WHERE id = ${sessionId}
`;

// NOT prepared statements
// const results = await sql.query("SELECT * FROM sessions WHERE id = $1", [sessionId]);
```

### Testing Tips

```bash
# Run tests in watch mode
bun test --watch

# Run specific test file
bun test api.test.ts

# Run tests with coverage
bun test --coverage
```

## Next Steps

- [02-architecture.md](./02-architecture.md) - Understand system design
- [12-cli-reference.md](./12-cli-reference.md) - CLI development
- [03-api-reference.md](./03-api-reference.md) - API details

---

**Thank you for contributing to DCM!** Your efforts help make multi-agent Claude Code sessions more powerful and reliable.
