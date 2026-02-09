<objective>
Create a comprehensive, reusable skill file that orchestrates a complete codebase audit
and customer-success polish workflow. The skill should verify backend-frontend-contract
alignment, code quality, security, accessibility, performance, and documentation.
It should then fix issues and update all documentation.

Output: ~/.claude/skills/full-codebase-audit/SKILL.md
</objective>

<context>
Available skills: 192 across code quality, testing, frontend, backend, security,
documentation, DevOps, and more.
Available agent types: 60+ specialized agents via Task tool.
User constraints: Max 5 parallel agents, wave-based execution, never code directly.
</context>

<requirements>
- Single command invocation (/full-codebase-audit)
- Auto-detect project stack
- 8 sequential waves with parallel agent dispatch
- Contract integrity verification (backend <-> frontend <-> API spec)
- Deep audit: code quality, security, accessibility, performance
- Customer success analysis: UX, design, product completeness
- Polish implementation: fix P0/P1 issues
- Documentation update: OpenAPI, README, inline docs
- Final report with scores
- Anti-regression validation
- Multiple execution modes (full, audit-only, polish-only, etc.)
</requirements>

<status>COMPLETED</status>
