/**
 * Static catalog of all known agents, skills, and commands
 * for the Claude Code ecosystem. This serves as a reference
 * database for the DCM registry catalog endpoint.
 * @module data/catalog
 */

// ============================================
// Type Definitions
// ============================================

export interface CatalogAgent {
  id: string;
  name: string;
  description: string;
  category: string;
  tools: string[];
}

export interface CatalogSkill {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface CatalogCommand {
  id: string;
  name: string;
  description: string;
  category: string;
}

// ============================================
// Agents Catalog
// ============================================

export const agents: CatalogAgent[] = [
  // ------------------------------------------
  // Core DCM Agents (Custom)
  // ------------------------------------------
  {
    id: "project-supervisor",
    name: "Project Supervisor",
    description: "Main orchestrator that supervises all agents, manages waves, and coordinates the overall project execution flow.",
    category: "orchestrator",
    tools: ["Task", "Bash", "Read", "Glob", "Grep"],
  },
  {
    id: "tech-lead",
    name: "Tech Lead",
    description: "Handles architecture decisions, technical design, and validates API contracts and system design.",
    category: "orchestrator",
    tools: ["Task", "Read", "Glob", "Grep", "Bash"],
  },
  {
    id: "impact-analyzer",
    name: "Impact Analyzer",
    description: "Mandatory pre-modification agent that analyzes the impact of changes on existing code, tests, and dependencies.",
    category: "validator",
    tools: ["Read", "Grep", "Glob", "Bash"],
  },
  {
    id: "regression-guard",
    name: "Regression Guard",
    description: "Mandatory post-modification agent that validates no regressions were introduced by running tests and checking contracts.",
    category: "validator",
    tools: ["Bash", "Read", "Grep", "Glob"],
  },
  {
    id: "frontend-react",
    name: "Frontend React Developer",
    description: "Expert in React, TypeScript, component architecture, hooks, state management, and frontend best practices.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "backend-laravel",
    name: "Backend Laravel Developer",
    description: "Expert in Laravel API development, Eloquent ORM, migrations, Form Requests, Resources, and Policies.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "supabase-backend",
    name: "Supabase Backend Expert",
    description: "Expert in Supabase database design, authentication, Row Level Security policies, and backend integration.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "supabase-edge",
    name: "Supabase Edge Functions Expert",
    description: "Expert in Supabase Edge Functions using Deno, serverless patterns, and edge computing.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "supabase-storage",
    name: "Supabase Storage Expert",
    description: "Expert in Supabase Storage configuration, bucket policies, file upload handling, and media management.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "supabase-realtime",
    name: "Supabase Realtime Expert",
    description: "Expert in Supabase Realtime subscriptions, channels, presence, and broadcast features.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "react-refine",
    name: "React Refine Expert",
    description: "Expert in React with Refine v5 framework for building admin panels, CRUD interfaces, and data providers.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "react-native-dev",
    name: "React Native Developer",
    description: "Expert in React Native mobile development, navigation, native modules, and cross-platform patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "react-native-ui",
    name: "React Native UI/UX Expert",
    description: "Expert in mobile UI/UX design, responsive layouts, animations, and platform-specific design patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "react-native-api",
    name: "React Native API Integration Expert",
    description: "Expert in mobile API integration, offline-first patterns, caching, and network handling.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "react-native-debug",
    name: "React Native Debug Expert",
    description: "Expert in debugging React Native applications, Flipper, Hermes, and native crash analysis.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "mobile-fullstack",
    name: "Mobile Fullstack Coordinator",
    description: "Coordinates mobile development with Supabase backend, manages end-to-end mobile features.",
    category: "orchestrator",
    tools: ["Task", "Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "fullstack-coordinator",
    name: "Fullstack Coordinator",
    description: "Synchronizes Laravel API backend with React frontend, ensuring contract consistency across the stack.",
    category: "orchestrator",
    tools: ["Task", "Read", "Glob", "Grep", "Bash"],
  },
  {
    id: "laravel-api",
    name: "Laravel API Expert",
    description: "Expert in Laravel RESTful API design, versioning, rate limiting, and API resource transformations.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "database-admin",
    name: "Database Administrator",
    description: "Expert in database design, query optimization, indexing strategies, and migration management.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "security-specialist",
    name: "Security Specialist",
    description: "Expert in OWASP security practices, vulnerability assessment, penetration testing, and security hardening.",
    category: "specialist",
    tools: ["Read", "Grep", "Glob", "Bash"],
  },
  {
    id: "gdpr-dpo",
    name: "GDPR Data Protection Officer",
    description: "Expert in RGPD/GDPR compliance, data protection impact assessments, and privacy by design.",
    category: "specialist",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "legal-compliance",
    name: "Legal Compliance Expert",
    description: "Expert in legal conformity, regulatory requirements, eIDAS, HDS, and compliance frameworks.",
    category: "specialist",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "contract-manager",
    name: "Contract Manager",
    description: "Expert in contract management, CGV, SLA definitions, and service-level agreements.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Grep"],
  },
  {
    id: "performance-engineer",
    name: "Performance Engineer",
    description: "Expert in performance profiling, load testing, bottleneck identification, and optimization strategies.",
    category: "specialist",
    tools: ["Read", "Bash", "Grep", "Glob"],
  },
  {
    id: "devops-infra",
    name: "DevOps Infrastructure Engineer",
    description: "Expert in CI/CD pipelines, Docker, Kubernetes, infrastructure as code, and deployment automation.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "designer-ui-ux",
    name: "UI/UX Designer",
    description: "Expert in user interface design, user experience patterns, design systems, and prototyping.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Glob"],
  },
  {
    id: "accessibility-specialist",
    name: "Accessibility Specialist",
    description: "Expert in WCAG 2.1 AA/AAA compliance, screen reader compatibility, and inclusive design patterns.",
    category: "specialist",
    tools: ["Read", "Grep", "Glob", "Bash"],
  },
  {
    id: "i18n-specialist",
    name: "Internationalization Specialist",
    description: "Expert in i18n/l10n implementation, translation management, locale handling, and RTL support.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },
  {
    id: "integration-specialist",
    name: "Integration Specialist",
    description: "Expert in third-party API integrations, webhooks, OAuth flows, and external service orchestration.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "migration-specialist",
    name: "Migration Specialist",
    description: "Expert in data migrations, schema evolution, zero-downtime migrations, and rollback strategies.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "finance-controller",
    name: "Finance Controller",
    description: "Expert in financial systems, invoicing, Factur-X compliance, and accounting integration.",
    category: "specialist",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "business-analyst",
    name: "Business Analyst",
    description: "Expert in business requirements analysis, process modeling, and functional specifications.",
    category: "researcher",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "product-manager",
    name: "Product Manager",
    description: "Expert in product roadmap planning, feature prioritization, and user story definition.",
    category: "researcher",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "market-researcher",
    name: "Market Researcher",
    description: "Expert in market studies, competitive analysis, and market positioning strategy.",
    category: "researcher",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "customer-success",
    name: "Customer Success Manager",
    description: "Expert in customer relationship management, onboarding flows, and user satisfaction optimization.",
    category: "researcher",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "hr-specialist",
    name: "HR Specialist",
    description: "Expert in human resources, recruitment processes, and team management practices.",
    category: "specialist",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "technical-writer",
    name: "Technical Writer",
    description: "Expert in technical documentation, API docs, user guides, and developer onboarding materials.",
    category: "writer",
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },
  {
    id: "seo-specialist",
    name: "SEO Specialist",
    description: "Expert in search engine optimization, structured data, meta tags, and organic traffic growth.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Grep", "Glob"],
  },
  {
    id: "wellness-advisor",
    name: "Wellness Advisor",
    description: "Expert in wellness and therapy domain knowledge, health data handling, and HDS compliance.",
    category: "specialist",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "n8n-specialist",
    name: "n8n Workflow Specialist",
    description: "Expert in n8n workflow automation, node configuration, triggers, and integration orchestration.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "superpdp-expert",
    name: "SuperPDP Expert",
    description: "Expert in electronic invoicing, Factur-X standards, and e-invoicing compliance.",
    category: "specialist",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "openapi-expert",
    name: "OpenAPI Expert",
    description: "Expert in OpenAPI specification, eSignature integration, and API documentation standards.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Built-in Claude Code Agents
  // ------------------------------------------
  {
    id: "Bash",
    name: "Bash Command Agent",
    description: "Executes shell commands, manages system operations, and handles terminal-based tasks.",
    category: "developer",
    tools: ["Bash"],
  },
  {
    id: "general-purpose",
    name: "General Purpose Agent",
    description: "General-purpose research and task execution agent for broad exploration and analysis.",
    category: "researcher",
    tools: ["Read", "Bash", "Glob", "Grep", "Edit", "Write"],
  },
  {
    id: "Explore",
    name: "Fast Explorer",
    description: "Fast codebase exploration agent optimized for quickly understanding project structure and finding relevant code.",
    category: "researcher",
    tools: ["Read", "Glob", "Grep"],
  },
  {
    id: "Plan",
    name: "Architecture Planner",
    description: "Software architecture planning agent that designs system structure, components, and technical approach.",
    category: "orchestrator",
    tools: ["Read", "Glob", "Grep"],
  },
  {
    id: "explore-codebase",
    name: "Codebase Explorer",
    description: "Deep codebase exploration agent that maps dependencies, analyzes patterns, and builds understanding.",
    category: "researcher",
    tools: ["Read", "Glob", "Grep", "Bash"],
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Reviews code for quality, patterns, security issues, and adherence to best practices.",
    category: "validator",
    tools: ["Read", "Glob", "Grep"],
  },
  {
    id: "qa-testing",
    name: "QA Testing Agent",
    description: "Quality assurance testing agent that creates and executes test plans and validates functionality.",
    category: "validator",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "test-engineer",
    name: "Test Engineer",
    description: "Creates comprehensive test suites including unit, integration, and end-to-end tests.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "docs-writer",
    name: "Documentation Writer",
    description: "Generates and maintains project documentation, READMEs, and inline code comments.",
    category: "writer",
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },
  {
    id: "security-auditor",
    name: "Security Auditor",
    description: "Performs security audits identifying vulnerabilities, OWASP risks, and security misconfigurations.",
    category: "validator",
    tools: ["Read", "Grep", "Glob", "Bash"],
  },
  {
    id: "performance-tuner",
    name: "Performance Tuner",
    description: "Optimizes application performance through profiling, caching strategies, and code optimization.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
  },
  {
    id: "refactor-expert",
    name: "Refactoring Expert",
    description: "Performs code refactoring to improve maintainability, reduce complexity, and apply design patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },
  {
    id: "root-cause-analyzer",
    name: "Root Cause Analyzer",
    description: "Debugs issues by tracing execution paths, analyzing logs, and identifying root causes of failures.",
    category: "validator",
    tools: ["Read", "Bash", "Grep", "Glob"],
  },
  {
    id: "clean-code-runner",
    name: "Clean Code Runner",
    description: "Analyzes code quality, identifies code smells, and suggests improvements following clean code principles.",
    category: "validator",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "code-simplifier",
    name: "Code Simplifier",
    description: "Simplifies complex code by reducing cognitive load, extracting abstractions, and removing duplication.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },
  {
    id: "websearch",
    name: "Web Search Agent",
    description: "Searches the web for documentation, solutions, and technical references.",
    category: "researcher",
    tools: ["Bash"],
  },
  {
    id: "fix-grammar",
    name: "Grammar Fixer",
    description: "Fixes grammar, spelling, and language issues in documentation and code comments.",
    category: "writer",
    tools: ["Read", "Edit", "Write", "Glob"],
  },
  {
    id: "Snipper",
    name: "Snipper",
    description: "Fast code modification agent optimized for quick, targeted edits across the codebase.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: Backend Development
  // ------------------------------------------
  {
    id: "backend-development:backend-architect",
    name: "Backend Architect",
    description: "Designs backend system architecture, microservices, API gateways, and distributed system patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  },
  {
    id: "backend-development:tdd-orchestrator",
    name: "TDD Orchestrator",
    description: "Guides test-driven development workflow: write failing test, implement code, refactor to green.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: Systems Programming
  // ------------------------------------------
  {
    id: "systems-programming:rust-pro",
    name: "Rust Professional",
    description: "Expert in Rust programming, ownership model, lifetimes, async runtime, and systems-level performance.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "systems-programming:golang-pro",
    name: "Go Professional",
    description: "Expert in Go programming, goroutines, channels, interfaces, and high-performance server development.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "systems-programming:cpp-pro",
    name: "C++ Professional",
    description: "Expert in modern C++ (17/20/23), templates, RAII, smart pointers, and systems programming.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "systems-programming:c-pro",
    name: "C Professional",
    description: "Expert in C programming, memory management, POSIX APIs, and embedded/kernel development.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: Python Development
  // ------------------------------------------
  {
    id: "python-development:python-pro",
    name: "Python Professional",
    description: "Expert in Python development, packaging, typing, async/await, and Pythonic design patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "python-development:fastapi-pro",
    name: "FastAPI Professional",
    description: "Expert in FastAPI framework, Pydantic models, dependency injection, and async API development.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "python-development:django-pro",
    name: "Django Professional",
    description: "Expert in Django framework, ORM, middleware, Django REST Framework, and admin customization.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: JavaScript/TypeScript
  // ------------------------------------------
  {
    id: "javascript-typescript:javascript-pro",
    name: "JavaScript Professional",
    description: "Expert in JavaScript, ES2024+, async patterns, module systems, and browser/Node.js runtime specifics.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "javascript-typescript:typescript-pro",
    name: "TypeScript Professional",
    description: "Expert in TypeScript, advanced type system, generics, discriminated unions, and type-safe patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: JVM Languages
  // ------------------------------------------
  {
    id: "jvm-languages:java-pro",
    name: "Java Professional",
    description: "Expert in Java, Spring Boot, JPA/Hibernate, concurrency, and enterprise application patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "jvm-languages:scala-pro",
    name: "Scala Professional",
    description: "Expert in Scala, functional programming, Akka, Play Framework, and JVM optimization.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "jvm-languages:csharp-pro",
    name: "C# Professional",
    description: "Expert in C#, .NET Core, ASP.NET, Entity Framework, LINQ, and Microsoft ecosystem development.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: Database Design
  // ------------------------------------------
  {
    id: "database-design:sql-pro",
    name: "SQL Professional",
    description: "Expert in SQL query writing, optimization, window functions, CTEs, and advanced database querying.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "database-design:database-architect",
    name: "Database Architect",
    description: "Expert in database schema design, normalization, indexing strategies, and data modeling.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: CI/CD & Cloud
  // ------------------------------------------
  {
    id: "cicd-automation:cloud-architect",
    name: "Cloud Architect",
    description: "Expert in cloud architecture, AWS/GCP/Azure services, scalability, and cost optimization.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "cicd-automation:kubernetes-architect",
    name: "Kubernetes Architect",
    description: "Expert in Kubernetes orchestration, Helm charts, service mesh, and container networking.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "cicd-automation:terraform-specialist",
    name: "Terraform Specialist",
    description: "Expert in Terraform infrastructure as code, modules, state management, and multi-cloud provisioning.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: LLM & AI
  // ------------------------------------------
  {
    id: "llm-application-dev:ai-engineer",
    name: "AI Engineer",
    description: "Expert in building LLM-powered applications, RAG pipelines, vector databases, and AI integration.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "llm-application-dev:prompt-engineer",
    name: "Prompt Engineer",
    description: "Expert in prompt design, few-shot learning, chain-of-thought, and LLM output optimization.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Glob"],
  },

  // ------------------------------------------
  // Plugin Agents: Machine Learning
  // ------------------------------------------
  {
    id: "machine-learning-ops:data-scientist",
    name: "Data Scientist",
    description: "Expert in data analysis, statistical modeling, feature engineering, and experiment design.",
    category: "researcher",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "machine-learning-ops:ml-engineer",
    name: "ML Engineer",
    description: "Expert in ML model training, deployment, MLOps pipelines, and model serving infrastructure.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: UI Design
  // ------------------------------------------
  {
    id: "ui-design:ui-designer",
    name: "UI Designer",
    description: "Expert in user interface design, visual hierarchy, color theory, typography, and layout systems.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Glob"],
  },
  {
    id: "ui-design:accessibility-expert",
    name: "Accessibility Expert",
    description: "Expert in web accessibility, ARIA attributes, screen reader testing, and WCAG compliance auditing.",
    category: "specialist",
    tools: ["Read", "Grep", "Glob", "Bash"],
  },
  {
    id: "ui-design:design-system-architect",
    name: "Design System Architect",
    description: "Expert in building design systems, component libraries, tokens, and cross-platform consistency.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: Comprehensive Review
  // ------------------------------------------
  {
    id: "comprehensive-review:architect-review",
    name: "Architecture Reviewer",
    description: "Reviews system architecture for scalability, maintainability, and adherence to design principles.",
    category: "validator",
    tools: ["Read", "Grep", "Glob"],
  },
  {
    id: "comprehensive-review:security-auditor",
    name: "Comprehensive Security Auditor",
    description: "Deep security review covering OWASP Top 10, dependency vulnerabilities, and configuration issues.",
    category: "validator",
    tools: ["Read", "Grep", "Glob", "Bash"],
  },

  // ------------------------------------------
  // Plugin Agents: Incident Response
  // ------------------------------------------
  {
    id: "incident-response:incident-responder",
    name: "Incident Responder",
    description: "Manages incident response, root cause analysis, post-mortem documentation, and recovery procedures.",
    category: "specialist",
    tools: ["Read", "Bash", "Grep", "Glob"],
  },
  {
    id: "incident-response:devops-troubleshooter",
    name: "DevOps Troubleshooter",
    description: "Troubleshoots infrastructure and deployment issues, analyzes logs, and restores service health.",
    category: "specialist",
    tools: ["Read", "Bash", "Grep", "Glob"],
  },

  // ------------------------------------------
  // Plugin Agents: Functional Programming
  // ------------------------------------------
  {
    id: "functional-programming:elixir-pro",
    name: "Elixir Professional",
    description: "Expert in Elixir, OTP, Phoenix Framework, LiveView, and concurrent distributed systems.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "functional-programming:haskell-pro",
    name: "Haskell Professional",
    description: "Expert in Haskell, monads, type classes, lazy evaluation, and purely functional programming patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: Game Development
  // ------------------------------------------
  {
    id: "game-development:unity-developer",
    name: "Unity Developer",
    description: "Expert in Unity game engine, C# scripting, physics, shaders, and game architecture patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "game-development:minecraft-bukkit-pro",
    name: "Minecraft Bukkit Developer",
    description: "Expert in Minecraft Bukkit/Spigot plugin development, event handling, and server modding.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: Blockchain & Web3
  // ------------------------------------------
  {
    id: "blockchain-web3:blockchain-developer",
    name: "Blockchain Developer",
    description: "Expert in blockchain development, smart contracts, Solidity, Web3 integration, and DeFi protocols.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: Reverse Engineering
  // ------------------------------------------
  {
    id: "reverse-engineering:reverse-engineer",
    name: "Reverse Engineer",
    description: "Expert in reverse engineering, binary analysis, protocol dissection, and system internals.",
    category: "researcher",
    tools: ["Read", "Bash", "Grep", "Glob"],
  },
  {
    id: "reverse-engineering:malware-analyst",
    name: "Malware Analyst",
    description: "Expert in malware analysis, threat identification, behavioral analysis, and indicators of compromise.",
    category: "researcher",
    tools: ["Read", "Bash", "Grep", "Glob"],
  },

  // ------------------------------------------
  // Plugin Agents: Shell Scripting
  // ------------------------------------------
  {
    id: "shell-scripting:bash-pro",
    name: "Bash Scripting Professional",
    description: "Expert in Bash scripting, shell automation, POSIX compliance, and Unix system administration.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "shell-scripting:posix-shell-pro",
    name: "POSIX Shell Professional",
    description: "Expert in POSIX-compliant shell scripting, portable scripts, and cross-platform shell compatibility.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: Web Scripting
  // ------------------------------------------
  {
    id: "web-scripting:php-pro",
    name: "PHP Professional",
    description: "Expert in PHP development, Composer, PSR standards, modern PHP 8.x features, and framework patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "web-scripting:ruby-pro",
    name: "Ruby Professional",
    description: "Expert in Ruby, Rails framework, gems, metaprogramming, and convention-over-configuration patterns.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },

  // ------------------------------------------
  // Plugin Agents: Quantitative Trading
  // ------------------------------------------
  {
    id: "quantitative-trading:quant-analyst",
    name: "Quantitative Analyst",
    description: "Expert in quantitative analysis, financial modeling, algorithmic trading strategies, and backtesting.",
    category: "researcher",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "quantitative-trading:risk-manager",
    name: "Risk Manager",
    description: "Expert in risk assessment, portfolio management, VaR modeling, and financial risk mitigation.",
    category: "researcher",
    tools: ["Read", "Bash", "Grep", "Glob"],
  },

  // ------------------------------------------
  // Plugin Agents: Content Marketing
  // ------------------------------------------
  {
    id: "content-marketing:content-marketer",
    name: "Content Marketer",
    description: "Expert in content strategy, editorial planning, content creation, and audience engagement.",
    category: "writer",
    tools: ["Read", "Edit", "Write", "Glob"],
  },
  {
    id: "content-marketing:search-specialist",
    name: "Search Specialist",
    description: "Expert in search marketing, SEM, keyword research, and search ranking optimization.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Grep", "Glob"],
  },

  // ------------------------------------------
  // Additional Plugin Agents
  // ------------------------------------------
  {
    id: "backend-development:api-designer",
    name: "API Designer",
    description: "Expert in RESTful and GraphQL API design, OpenAPI specifications, and API versioning strategies.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },
  {
    id: "backend-development:microservices-architect",
    name: "Microservices Architect",
    description: "Expert in microservices patterns, service decomposition, event sourcing, and distributed systems.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "cicd-automation:github-actions-pro",
    name: "GitHub Actions Professional",
    description: "Expert in GitHub Actions workflows, reusable actions, matrix builds, and CI/CD automation.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "cicd-automation:docker-specialist",
    name: "Docker Specialist",
    description: "Expert in Docker containerization, multi-stage builds, Docker Compose, and container security.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "database-design:nosql-pro",
    name: "NoSQL Professional",
    description: "Expert in NoSQL databases including MongoDB, Redis, DynamoDB, and document/key-value store patterns.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "database-design:data-modeler",
    name: "Data Modeler",
    description: "Expert in data modeling, ER diagrams, normalization, and schema evolution strategies.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },
  {
    id: "llm-application-dev:rag-specialist",
    name: "RAG Specialist",
    description: "Expert in Retrieval-Augmented Generation, vector embeddings, chunking strategies, and semantic search.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "machine-learning-ops:mlops-engineer",
    name: "MLOps Engineer",
    description: "Expert in ML model lifecycle, experiment tracking, model registries, and automated ML pipelines.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "systems-programming:embedded-pro",
    name: "Embedded Systems Professional",
    description: "Expert in embedded programming, RTOS, hardware interfaces, and resource-constrained development.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "javascript-typescript:nextjs-pro",
    name: "Next.js Professional",
    description: "Expert in Next.js framework, server components, app router, ISR, and full-stack React development.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "javascript-typescript:react-pro",
    name: "React Professional",
    description: "Expert in React architecture, hooks, context, suspense, concurrent features, and React ecosystem.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "javascript-typescript:node-pro",
    name: "Node.js Professional",
    description: "Expert in Node.js runtime, event loop, streams, worker threads, and server-side JavaScript.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "javascript-typescript:bun-pro",
    name: "Bun Professional",
    description: "Expert in Bun runtime, Bun APIs, bundling, testing, and high-performance JavaScript execution.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "python-development:flask-pro",
    name: "Flask Professional",
    description: "Expert in Flask framework, Blueprints, extensions, Jinja2 templating, and lightweight web development.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "jvm-languages:kotlin-pro",
    name: "Kotlin Professional",
    description: "Expert in Kotlin, coroutines, Ktor, Android development, and Kotlin multiplatform projects.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "jvm-languages:spring-boot-pro",
    name: "Spring Boot Professional",
    description: "Expert in Spring Boot, dependency injection, Spring Security, WebFlux, and enterprise Java development.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "functional-programming:ocaml-pro",
    name: "OCaml Professional",
    description: "Expert in OCaml, type inference, pattern matching, module system, and functional systems programming.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "game-development:unreal-developer",
    name: "Unreal Engine Developer",
    description: "Expert in Unreal Engine, Blueprints, C++ gameplay programming, and game rendering pipelines.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "game-development:godot-developer",
    name: "Godot Developer",
    description: "Expert in Godot engine, GDScript, scene system, and open-source game development workflows.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "blockchain-web3:solidity-pro",
    name: "Solidity Professional",
    description: "Expert in Solidity smart contracts, EVM, gas optimization, and DeFi protocol development.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "web-scripting:laravel-pro",
    name: "Laravel Professional",
    description: "Expert in Laravel framework, Eloquent, Blade, queues, events, and PHP ecosystem best practices.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "web-scripting:wordpress-pro",
    name: "WordPress Professional",
    description: "Expert in WordPress development, custom themes, plugins, Gutenberg blocks, and WP REST API.",
    category: "developer",
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  },
  {
    id: "content-marketing:copywriter",
    name: "Copywriter",
    description: "Expert in persuasive copywriting, landing pages, email sequences, and conversion-focused content.",
    category: "writer",
    tools: ["Read", "Edit", "Write", "Glob"],
  },
  {
    id: "content-marketing:social-media-manager",
    name: "Social Media Manager",
    description: "Expert in social media strategy, content calendars, community management, and platform optimization.",
    category: "writer",
    tools: ["Read", "Edit", "Write", "Glob"],
  },
  {
    id: "incident-response:sre-engineer",
    name: "SRE Engineer",
    description: "Expert in site reliability engineering, SLOs/SLIs, error budgets, and production observability.",
    category: "specialist",
    tools: ["Read", "Bash", "Grep", "Glob"],
  },
  {
    id: "ui-design:motion-designer",
    name: "Motion Designer",
    description: "Expert in UI animations, transitions, micro-interactions, and motion design principles.",
    category: "specialist",
    tools: ["Read", "Edit", "Write", "Glob"],
  },
];

// ============================================
// Skills Catalog
// ============================================

export const skills: CatalogSkill[] = [
  // ------------------------------------------
  // Git Skills
  // ------------------------------------------
  {
    id: "git-commit",
    name: "Git Commit",
    description: "Creates clean, conventional commits with proper message formatting and file staging.",
    category: "git",
  },
  {
    id: "git-create-pr",
    name: "Git Create PR",
    description: "Creates pull requests with auto-generated title, summary, and test plan documentation.",
    category: "git",
  },
  {
    id: "git-merge",
    name: "Git Merge",
    description: "Manages git merge operations, conflict resolution, and branch integration strategies.",
    category: "git",
  },
  {
    id: "git-fix-pr-comments",
    name: "Git Fix PR Comments",
    description: "Reads PR review comments and applies requested changes with appropriate commits.",
    category: "git",
  },

  // ------------------------------------------
  // Workflow Skills
  // ------------------------------------------
  {
    id: "workflow-brainstorm",
    name: "Brainstorm Workflow",
    description: "Structured brainstorming workflow for iterative deep research and solution exploration.",
    category: "workflow",
  },
  {
    id: "workflow-debug",
    name: "Debug Workflow",
    description: "Systematic debugging workflow with hypothesis testing, log analysis, and root cause identification.",
    category: "workflow",
  },
  {
    id: "workflow-clean-code",
    name: "Clean Code Workflow",
    description: "Analyzes and improves code quality following SOLID principles and clean code practices.",
    category: "workflow",
  },
  {
    id: "workflow-review",
    name: "Code Review Workflow",
    description: "Expert code review workflow covering security, performance, patterns, and best practices.",
    category: "workflow",
  },
  {
    id: "workflow-codebase-excellence",
    name: "Codebase Excellence",
    description: "Comprehensive codebase improvement workflow targeting technical debt and quality metrics.",
    category: "workflow",
  },

  // ------------------------------------------
  // Senior Engineering Skills
  // ------------------------------------------
  {
    id: "senior-frontend",
    name: "Senior Frontend Engineer",
    description: "Senior-level frontend expertise covering React, performance, accessibility, and architecture.",
    category: "engineering",
  },
  {
    id: "senior-backend",
    name: "Senior Backend Engineer",
    description: "Senior-level backend expertise covering API design, databases, caching, and scalability.",
    category: "engineering",
  },
  {
    id: "senior-fullstack",
    name: "Senior Fullstack Engineer",
    description: "Senior-level fullstack expertise bridging frontend and backend with end-to-end feature delivery.",
    category: "engineering",
  },
  {
    id: "senior-architect",
    name: "Senior Architect",
    description: "Senior-level system architecture expertise covering distributed systems and design decisions.",
    category: "engineering",
  },
  {
    id: "senior-devops",
    name: "Senior DevOps Engineer",
    description: "Senior-level DevOps expertise covering CI/CD, infrastructure, monitoring, and reliability.",
    category: "engineering",
  },
  {
    id: "senior-qa",
    name: "Senior QA Engineer",
    description: "Senior-level QA expertise covering test strategy, automation frameworks, and quality processes.",
    category: "engineering",
  },
  {
    id: "senior-security",
    name: "Senior Security Engineer",
    description: "Senior-level security expertise covering threat modeling, secure coding, and compliance.",
    category: "engineering",
  },
  {
    id: "senior-secops",
    name: "Senior SecOps Engineer",
    description: "Senior-level security operations covering incident response, SIEM, and threat detection.",
    category: "engineering",
  },
  {
    id: "senior-data-scientist",
    name: "Senior Data Scientist",
    description: "Senior-level data science expertise covering statistical analysis, ML models, and data pipelines.",
    category: "engineering",
  },
  {
    id: "senior-data-engineer",
    name: "Senior Data Engineer",
    description: "Senior-level data engineering covering ETL pipelines, data warehousing, and stream processing.",
    category: "engineering",
  },
  {
    id: "senior-ml-engineer",
    name: "Senior ML Engineer",
    description: "Senior-level ML engineering covering model training, serving, MLOps, and production ML systems.",
    category: "engineering",
  },
  {
    id: "senior-prompt-engineer",
    name: "Senior Prompt Engineer",
    description: "Senior-level prompt engineering covering system prompts, few-shot design, and LLM optimization.",
    category: "engineering",
  },

  // ------------------------------------------
  // Code Quality Skills
  // ------------------------------------------
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Reviews code for quality, security, performance, and adherence to project conventions.",
    category: "code-quality",
  },
  {
    id: "test-specialist",
    name: "Test Specialist",
    description: "Designs test strategies covering unit, integration, e2e, and property-based testing approaches.",
    category: "testing",
  },
  {
    id: "test-generator",
    name: "Test Generator",
    description: "Automatically generates comprehensive test suites from existing code and specifications.",
    category: "testing",
  },

  // ------------------------------------------
  // Security Skills
  // ------------------------------------------
  {
    id: "security-auditor",
    name: "Security Auditor",
    description: "Performs security audits identifying OWASP vulnerabilities, dependency risks, and misconfigurations.",
    category: "security",
  },
  {
    id: "security-compliance",
    name: "Security Compliance",
    description: "Validates compliance with security frameworks including SOC2, ISO 27001, and GDPR requirements.",
    category: "security",
  },

  // ------------------------------------------
  // Documentation & Exploration Skills
  // ------------------------------------------
  {
    id: "docs",
    name: "Documentation",
    description: "Generates and maintains project documentation, API references, and developer guides.",
    category: "documentation",
  },
  {
    id: "explain",
    name: "Code Explainer",
    description: "Explains complex code, algorithms, and architectural decisions in clear, accessible language.",
    category: "documentation",
  },
  {
    id: "explore",
    name: "Explore",
    description: "Explores codebases to understand structure, patterns, dependencies, and design decisions.",
    category: "workflow",
  },
  {
    id: "review",
    name: "Review",
    description: "Comprehensive code review covering correctness, style, security, and best practices.",
    category: "code-quality",
  },
  {
    id: "search",
    name: "Search",
    description: "Deep search through codebases, documentation, and references to find relevant information.",
    category: "workflow",
  },

  // ------------------------------------------
  // Orchestration Skills
  // ------------------------------------------
  {
    id: "brainstorm",
    name: "Brainstorm",
    description: "Iterative deep research methodology with multiple rounds of analysis and refinement.",
    category: "workflow",
  },
  {
    id: "orchestrate",
    name: "Orchestrate",
    description: "Orchestrates multi-agent workflows, manages task distribution, and coordinates parallel work.",
    category: "workflow",
  },
  {
    id: "parallel-workers",
    name: "Parallel Workers",
    description: "Manages parallel task execution across multiple worker agents for faster completion.",
    category: "workflow",
  },

  // ------------------------------------------
  // Documentation Generation Skills
  // ------------------------------------------
  {
    id: "mermaid-diagrams",
    name: "Mermaid Diagrams",
    description: "Generates Mermaid.js diagrams for architecture, flow, sequence, and entity relationship visualization.",
    category: "documentation",
  },
  {
    id: "changelog-generator",
    name: "Changelog Generator",
    description: "Generates structured changelogs from git history following Keep a Changelog conventions.",
    category: "documentation",
  },
  {
    id: "readme-updater",
    name: "README Updater",
    description: "Updates README files with current project state, badges, installation steps, and usage examples.",
    category: "documentation",
  },

  // ------------------------------------------
  // Deployment Skills
  // ------------------------------------------
  {
    id: "docker-containerization",
    name: "Docker Containerization",
    description: "Creates optimized Dockerfiles, multi-stage builds, and Docker Compose configurations.",
    category: "deployment",
  },
  {
    id: "bun-development",
    name: "Bun Development",
    description: "Leverages Bun runtime features for development, testing, bundling, and package management.",
    category: "deployment",
  },

  // ------------------------------------------
  // Design Skills
  // ------------------------------------------
  {
    id: "ui-ux-pro-max",
    name: "UI/UX Pro Max",
    description: "Advanced UI/UX design expertise covering user research, wireframing, and interaction design.",
    category: "design",
  },
  {
    id: "web-design-guidelines",
    name: "Web Design Guidelines",
    description: "Applies web design best practices including responsive design, typography, and visual hierarchy.",
    category: "design",
  },
  {
    id: "canvas-design",
    name: "Canvas Design",
    description: "Creates visual designs using HTML Canvas, SVG graphics, and data visualization.",
    category: "design",
  },

  // ------------------------------------------
  // Marketing Skills
  // ------------------------------------------
  {
    id: "seo-optimizer",
    name: "SEO Optimizer",
    description: "Optimizes web content for search engines including meta tags, structured data, and performance.",
    category: "marketing",
  },
  {
    id: "brand-identity",
    name: "Brand Identity",
    description: "Develops brand identity including visual language, tone of voice, and brand guidelines.",
    category: "marketing",
  },
  {
    id: "marketing-strategy-pmm",
    name: "Marketing Strategy PMM",
    description: "Product marketing strategy covering positioning, messaging, go-to-market, and competitive analysis.",
    category: "marketing",
  },

  // ------------------------------------------
  // Business & Analytics Skills
  // ------------------------------------------
  {
    id: "data-analyst",
    name: "Data Analyst",
    description: "Analyzes data sets, creates visualizations, and extracts actionable insights from metrics.",
    category: "business",
  },
  {
    id: "business-analytics-reporter",
    name: "Business Analytics Reporter",
    description: "Generates business analytics reports with KPIs, trends, and executive summaries.",
    category: "business",
  },
  {
    id: "ceo-advisor",
    name: "CEO Advisor",
    description: "Provides strategic business advice on growth, operations, and executive decision-making.",
    category: "business",
  },
  {
    id: "startup-validator",
    name: "Startup Validator",
    description: "Validates startup ideas, business models, market fit, and go-to-market feasibility.",
    category: "business",
  },

  // ------------------------------------------
  // Utility Skills
  // ------------------------------------------
  {
    id: "pdf",
    name: "PDF Handler",
    description: "Reads, analyzes, and extracts content from PDF documents for processing and summarization.",
    category: "workflow",
  },
  {
    id: "generate-image",
    name: "Image Generator",
    description: "Generates images, diagrams, and visual assets from text descriptions.",
    category: "design",
  },
  {
    id: "humanizer",
    name: "Humanizer",
    description: "Rewrites AI-generated text to sound natural, human, and conversational while preserving meaning.",
    category: "documentation",
  },

  // ------------------------------------------
  // Additional Engineering Skills
  // ------------------------------------------
  {
    id: "clean-code",
    name: "Clean Code",
    description: "Applies clean code principles including SOLID, DRY, KISS, and meaningful naming conventions.",
    category: "code-quality",
  },
  {
    id: "review-code",
    name: "Review Code",
    description: "Expert code review covering OWASP security, SOLID principles, and performance optimization.",
    category: "code-quality",
  },
  {
    id: "apex",
    name: "APEX Methodology",
    description: "Structured Analyze-Plan-Execute methodology for systematic problem-solving and task completion.",
    category: "workflow",
  },
  {
    id: "ultrathink",
    name: "Ultra Think",
    description: "Deep thinking mode for complex architectural decisions and critical problem analysis.",
    category: "workflow",
  },
  {
    id: "reducing-entropy",
    name: "Reducing Entropy",
    description: "Optimizes codebase size by removing dead code, consolidating duplicates, and simplifying logic.",
    category: "code-quality",
  },
  {
    id: "ci-fixer",
    name: "CI Fixer",
    description: "Automatically diagnoses and fixes CI/CD pipeline failures, test errors, and build issues.",
    category: "deployment",
  },

  // ------------------------------------------
  // Additional Testing Skills
  // ------------------------------------------
  {
    id: "e2e-testing",
    name: "E2E Testing",
    description: "Creates end-to-end tests using Playwright, Cypress, or Puppeteer for full user flow validation.",
    category: "testing",
  },
  {
    id: "api-testing",
    name: "API Testing",
    description: "Creates comprehensive API test suites covering endpoints, edge cases, and error handling.",
    category: "testing",
  },
  {
    id: "load-testing",
    name: "Load Testing",
    description: "Designs and executes load tests using k6, Artillery, or JMeter for performance validation.",
    category: "testing",
  },

  // ------------------------------------------
  // Additional Documentation Skills
  // ------------------------------------------
  {
    id: "openapi-spec",
    name: "OpenAPI Specification",
    description: "Creates and maintains OpenAPI/Swagger specifications with examples and schema definitions.",
    category: "documentation",
  },
  {
    id: "writing-clearly-and-concisely",
    name: "Clear Writing",
    description: "Writes clear, concise technical content optimized for readability and comprehension.",
    category: "documentation",
  },
  {
    id: "technical-blog",
    name: "Technical Blog",
    description: "Writes technical blog posts, tutorials, and thought leadership content for developer audiences.",
    category: "documentation",
  },

  // ------------------------------------------
  // Additional Security Skills
  // ------------------------------------------
  {
    id: "penetration-testing",
    name: "Penetration Testing",
    description: "Performs penetration testing to identify security vulnerabilities and attack vectors.",
    category: "security",
  },
  {
    id: "threat-modeling",
    name: "Threat Modeling",
    description: "Creates threat models using STRIDE/DREAD methodologies to identify and mitigate security risks.",
    category: "security",
  },
  {
    id: "dependency-audit",
    name: "Dependency Audit",
    description: "Audits project dependencies for known vulnerabilities, license issues, and supply chain risks.",
    category: "security",
  },

  // ------------------------------------------
  // Additional Deployment Skills
  // ------------------------------------------
  {
    id: "kubernetes-deployment",
    name: "Kubernetes Deployment",
    description: "Creates Kubernetes manifests, Helm charts, and deployment strategies for container orchestration.",
    category: "deployment",
  },
  {
    id: "terraform-iac",
    name: "Terraform IaC",
    description: "Creates Terraform modules and configurations for infrastructure as code provisioning.",
    category: "deployment",
  },
  {
    id: "monitoring-observability",
    name: "Monitoring & Observability",
    description: "Sets up monitoring, alerting, logging, and tracing with Prometheus, Grafana, and OpenTelemetry.",
    category: "deployment",
  },

  // ------------------------------------------
  // Additional Design Skills
  // ------------------------------------------
  {
    id: "responsive-design",
    name: "Responsive Design",
    description: "Creates responsive layouts that adapt seamlessly across mobile, tablet, and desktop viewports.",
    category: "design",
  },
  {
    id: "design-tokens",
    name: "Design Tokens",
    description: "Defines and manages design tokens for consistent theming across components and platforms.",
    category: "design",
  },
  {
    id: "animation-design",
    name: "Animation Design",
    description: "Creates CSS and JavaScript animations, transitions, and micro-interactions for engaging UIs.",
    category: "design",
  },

  // ------------------------------------------
  // Additional Marketing Skills
  // ------------------------------------------
  {
    id: "seo-audit",
    name: "SEO Audit",
    description: "Performs comprehensive SEO audits covering technical SEO, content, and backlink analysis.",
    category: "marketing",
  },
  {
    id: "schema-markup",
    name: "Schema Markup",
    description: "Implements structured data markup using Schema.org for rich search result snippets.",
    category: "marketing",
  },
  {
    id: "conversion-optimization",
    name: "Conversion Optimization",
    description: "Optimizes conversion funnels through A/B testing, UX improvements, and CTA optimization.",
    category: "marketing",
  },
  {
    id: "email-marketing",
    name: "Email Marketing",
    description: "Creates email marketing campaigns, automation sequences, and newsletter content.",
    category: "marketing",
  },

  // ------------------------------------------
  // Additional Business Skills
  // ------------------------------------------
  {
    id: "product-roadmap",
    name: "Product Roadmap",
    description: "Creates product roadmaps with feature prioritization, milestones, and delivery timelines.",
    category: "business",
  },
  {
    id: "competitive-analysis",
    name: "Competitive Analysis",
    description: "Analyzes competitor products, strategies, and market positioning for strategic planning.",
    category: "business",
  },
  {
    id: "pitch-deck",
    name: "Pitch Deck",
    description: "Creates compelling pitch decks for investors, partners, and stakeholder presentations.",
    category: "business",
  },
  {
    id: "financial-modeling",
    name: "Financial Modeling",
    description: "Builds financial models, revenue projections, and unit economics for business planning.",
    category: "business",
  },
];

// ============================================
// Commands Catalog
// ============================================

export const commands: CatalogCommand[] = [
  // ------------------------------------------
  // Built-in Commands
  // ------------------------------------------
  {
    id: "/help",
    name: "Help",
    description: "Shows help information about available commands and how to use Claude Code.",
    category: "builtin",
  },
  {
    id: "/clear",
    name: "Clear",
    description: "Clears the current conversation context and starts fresh.",
    category: "builtin",
  },
  {
    id: "/compact",
    name: "Compact",
    description: "Compacts the conversation context to reduce token usage while preserving key information.",
    category: "builtin",
  },
  {
    id: "/cost",
    name: "Cost",
    description: "Shows the current conversation token usage and estimated cost breakdown.",
    category: "builtin",
  },
  {
    id: "/doctor",
    name: "Doctor",
    description: "Runs diagnostic checks on the Claude Code installation and reports any issues.",
    category: "builtin",
  },
  {
    id: "/init",
    name: "Init",
    description: "Initializes a CLAUDE.md file for the current project with recommended configuration.",
    category: "builtin",
  },
  {
    id: "/login",
    name: "Login",
    description: "Authenticates with Anthropic API or switches between authentication methods.",
    category: "builtin",
  },
  {
    id: "/logout",
    name: "Logout",
    description: "Logs out from the current Anthropic API session and clears credentials.",
    category: "builtin",
  },
  {
    id: "/memory",
    name: "Memory",
    description: "Manages persistent memory notes that carry across conversations and sessions.",
    category: "builtin",
  },
  {
    id: "/model",
    name: "Model",
    description: "Shows or switches the current Claude model being used for the conversation.",
    category: "builtin",
  },
  {
    id: "/permissions",
    name: "Permissions",
    description: "Manages tool permissions, allowing or denying specific tool access for the session.",
    category: "builtin",
  },
  {
    id: "/review",
    name: "Review",
    description: "Starts a code review of the current changes or specified files.",
    category: "builtin",
  },
  {
    id: "/status",
    name: "Status",
    description: "Shows the current session status including model, permissions, and configuration.",
    category: "builtin",
  },
  {
    id: "/vim",
    name: "Vim Mode",
    description: "Toggles vim-style keybindings for the input editor.",
    category: "builtin",
  },
  {
    id: "/config",
    name: "Config",
    description: "Opens or displays the Claude Code configuration settings.",
    category: "builtin",
  },
  {
    id: "/bug",
    name: "Bug Report",
    description: "Submits a bug report with session context to help improve Claude Code.",
    category: "builtin",
  },
  {
    id: "/terminal-setup",
    name: "Terminal Setup",
    description: "Configures terminal integration settings for optimal Claude Code experience.",
    category: "builtin",
  },

  // ------------------------------------------
  // Plugin Commands
  // ------------------------------------------
  {
    id: "/seo-audit",
    name: "SEO Audit",
    description: "Runs a comprehensive SEO audit on the current project or specified URLs.",
    category: "plugin",
  },
  {
    id: "/schema-markup",
    name: "Schema Markup",
    description: "Generates or validates Schema.org structured data markup for web pages.",
    category: "plugin",
  },
  {
    id: "/security-scan",
    name: "Security Scan",
    description: "Runs automated security scanning on the codebase looking for common vulnerabilities.",
    category: "plugin",
  },
  {
    id: "/performance-audit",
    name: "Performance Audit",
    description: "Runs a performance audit analyzing bundle size, render time, and optimization opportunities.",
    category: "plugin",
  },
  {
    id: "/accessibility-check",
    name: "Accessibility Check",
    description: "Checks web pages and components for WCAG accessibility compliance issues.",
    category: "plugin",
  },
  {
    id: "/dependency-check",
    name: "Dependency Check",
    description: "Checks project dependencies for vulnerabilities, updates, and license compatibility.",
    category: "plugin",
  },
  {
    id: "/generate-tests",
    name: "Generate Tests",
    description: "Auto-generates test files for specified modules, functions, or components.",
    category: "plugin",
  },
  {
    id: "/deploy",
    name: "Deploy",
    description: "Triggers deployment workflow for the current project to the configured environment.",
    category: "plugin",
  },
];
