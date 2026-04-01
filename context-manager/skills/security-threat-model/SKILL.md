---
name: "security-threat-model"
description: "Comprehensive security threat modeling skill: repository-grounded threat modeling (STRIDE, PASTA, attack trees), attack tree construction and path analysis, threat-to-control mitigation mapping, and risk prioritization. Covers trust boundaries, assets, attacker capabilities, abuse paths, mitigations, defense-in-depth, and remediation roadmaps. Trigger when the user asks to threat model a codebase or path, enumerate threats/abuse paths, build attack trees, map mitigations to threats, or perform AppSec threat modeling. Do not trigger for general architecture summaries, code review, or non-security design work."
author: openai
---

# Security Threat Model

Deliver an actionable AppSec-grade threat model that is specific to the repository or a project path, not a generic checklist. Anchor every architectural claim to evidence in the repo and keep assumptions explicit. Prioritize realistic attacker goals and concrete impacts over generic checklists.

## Capabilities

- STRIDE threat analysis
- PASTA methodology
- Attack tree construction and path analysis (OR/AND decomposition, attribute annotation, Mermaid/PlantUML export)
- Data flow diagram analysis
- Security requirement extraction
- Risk prioritization and scoring (likelihood x impact)
- Mitigation strategy design and control mapping
- Defense-in-depth coverage analysis
- Remediation roadmap generation
- Control effectiveness testing
- Security control library management

## Use this skill when

- Threat modeling a codebase, repo, or sub-path
- Enumerating threats, abuse paths, or attack vectors
- Building or analyzing attack trees
- Mapping threats to security controls and mitigations
- Designing new systems or features with security in mind
- Reviewing architecture for security gaps
- Prioritizing security investments or creating remediation roadmaps
- Validating control coverage and defense-in-depth
- Preparing for security audits
- Creating security documentation
- Risk treatment planning

## Do not use this skill when

- General architecture summaries or non-security design work
- Code review unrelated to security
- Legal or compliance certification (use compliance-specific skills)
- Automated scanning without human review
- You lack scope or authorization for security review

## Quick start

1) Collect (or infer) inputs:
- Repo root path and any in-scope paths.
- Intended usage, deployment model, internet exposure, and auth expectations (if known).
- Any existing repository summary or architecture spec.
- Use prompts in `references/prompt-template.md` to generate a repository summary.
- Follow the required output contract in `references/prompt-template.md`. Use it verbatim when possible.

## Workflow

### 1) Scope and extract the system model
- Identify primary components, data stores, and external integrations from the repo summary.
- Identify how the system runs (server, CLI, library, worker) and its entrypoints.
- Separate runtime behavior from CI/build/dev tooling and from tests/examples.
- Map the in-scope locations to those components and exclude out-of-scope items explicitly.
- Do not claim components, flows, or controls without evidence.

### 2) Derive boundaries, assets, and entry points
- Enumerate trust boundaries as concrete edges between components, noting protocol, auth, encryption, validation, and rate limiting.
- List assets that drive risk (data, credentials, models, config, compute resources, audit logs).
- Identify entry points (endpoints, upload surfaces, parsers/decoders, job triggers, admin tooling, logging/error sinks).

### 3) Calibrate assets and attacker capabilities
- List the assets that drive risk (credentials, PII, integrity-critical state, availability-critical components, build artifacts).
- Describe realistic attacker capabilities based on exposure and intended usage.
- Explicitly note non-capabilities to avoid inflated severity.

### 4) Enumerate threats as abuse paths
- Prefer attacker goals that map to assets and boundaries (exfiltration, privilege escalation, integrity compromise, denial of service).
- Apply STRIDE to each component and data flow.
- Classify each threat and tie it to impacted assets.
- Keep the number of threats small but high quality.

### 5) Build attack trees for critical paths
- For each critical threat, construct an attack tree:
  - Define the root goal (attacker objective).
  - Decompose into sub-goals using AND/OR structure.
  - Annotate leaf nodes with attributes: cost, skill level, time, and detectability.
  - Map mitigations per branch and prioritize high-impact paths.
- Analyze attack paths: find easiest, cheapest, and stealthiest paths.
- Identify critical nodes that appear in the most paths.
- Export trees as Mermaid or PlantUML diagrams for stakeholder communication.
- See `references/attack-tree-playbook.md` for data models, builders, exporters, and path analysis templates.

### 6) Prioritize with explicit likelihood and impact reasoning
- Use qualitative likelihood and impact (low/medium/high) with short justifications.
- Set overall priority (critical/high/medium/low) using likelihood x impact, adjusted for existing controls.
- State which assumptions most influence the ranking.

### 7) Validate service context and assumptions with the user
- Summarize key assumptions that materially affect threat ranking or scope, then ask the user to confirm or correct them.
- Ask 1-3 targeted questions to resolve missing context (service owner and environment, scale/users, deployment model, authn/authz, internet exposure, data sensitivity, multi-tenancy).
- Pause and wait for user feedback before producing the final report.
- If the user declines or can't answer, state which assumptions remain and how they influence priority.

### 8) Map threats to mitigations (control mapping)
- Distinguish existing mitigations (with evidence) from recommended mitigations.
- Tie mitigations to concrete locations (component, boundary, or entry point) and control types (authZ checks, input validation, schema enforcement, sandboxing, rate limits, secrets isolation, audit logging).
- Categorize controls by type (preventive, detective, corrective) and layer (network, application, data, endpoint, process).
- Validate defense-in-depth: ensure multiple layers and control types cover each critical threat.
- Identify mitigation gaps: insufficient coverage, missing control diversity, single points of failure.
- Prefer specific implementation hints over generic advice (e.g., "enforce schema at gateway for upload payloads" vs "validate inputs").
- Base recommendations on validated user context; if assumptions remain unresolved, mark recommendations as conditional.
- See `references/mitigation-mapping-playbook.md` for control library, mitigation models, analysis templates, and effectiveness testing.

### 9) Generate remediation roadmap
- Phase 1: Critical threats with low coverage (immediate action).
- Phase 2: High-impact threats needing additional controls.
- Phase 3: Medium/low threats and defense-in-depth hardening.
- For each phase, list specific controls, estimated cost, and coverage impact.

### 10) Run a quality check before finalizing
- Confirm all discovered entrypoints are covered.
- Confirm each trust boundary is represented in threats.
- Confirm runtime vs CI/dev separation.
- Confirm user clarifications (or explicit non-responses) are reflected.
- Confirm assumptions and open questions are explicit.
- Confirm that the format of the report matches closely the required output format defined in prompt template: `references/prompt-template.md`
- Write the final Markdown to a file named `<repo-or-dir-name>-threat-model.md` (use the basename of the repo root, or the in-scope directory if you were asked to model a subpath).

## Risk prioritization guidance (illustrative, not exhaustive)
- High: pre-auth RCE, auth bypass, cross-tenant access, sensitive data exfiltration, key or token theft, model or config integrity compromise, sandbox escape.
- Medium: targeted DoS of critical components, partial data exposure, rate-limit bypass with measurable impact, log/metrics poisoning that affects detection.
- Low: low-sensitivity info leaks, noisy DoS with easy mitigation, issues requiring unlikely preconditions.

## Best Practices

### Threat Modeling
- Involve developers in threat modeling sessions
- Focus on data flows, not just components
- Consider insider threats
- Update threat models with architecture changes
- Link threats to security requirements
- Track mitigations to implementation
- Review regularly, not just at design time

### Attack Trees
- Start with clear attacker goals
- Be exhaustive in considering all attack vectors
- Attribute attacks with cost, skill, and detection metrics
- Validate trees with red team experts
- Do not ignore AND-node dependencies
- Do not forget insider threats

### Mitigation Mapping
- Map all threats (no threat should be unmapped)
- Layer controls for defense in depth
- Mix control types (preventive, detective, corrective)
- Track effectiveness and measure improvement
- Review regularly (controls degrade over time)
- Do not rely on single controls (avoid single points of failure)
- Consider ROI when prioritizing controls

## Safety

- Never output secrets. Redact tokens/keys/passwords and only describe their presence and location.
- Avoid storing sensitive details in threat models without access controls.
- Share attack trees only with authorized stakeholders.
- Avoid including sensitive exploit details unless required.
- Keep threat models updated after architecture changes.

## References

- Output contract and full prompt template: `references/prompt-template.md`
- Security controls and asset categories: `references/security-controls-and-assets.md`
- Attack tree construction patterns and templates: `references/attack-tree-playbook.md`
- Threat mitigation mapping patterns and templates: `references/mitigation-mapping-playbook.md`
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [CIS Controls](https://www.cisecurity.org/controls)
- [MITRE ATT&CK Framework](https://attack.mitre.org/)
- [MITRE D3FEND](https://d3fend.mitre.org/)
- [Attack Trees by Bruce Schneier](https://www.schneier.com/academic/archives/1999/12/attack_trees.html)
- [OWASP Attack Surface Analysis](https://owasp.org/www-community/controls/Attack_Surface_Analysis_Cheat_Sheet)

Only load the reference files you need. Keep the final result concise, grounded, and reviewable.
