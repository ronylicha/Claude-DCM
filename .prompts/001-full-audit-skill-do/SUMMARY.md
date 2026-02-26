# Full Codebase Audit Skill - Creation Summary

**Skill d'orchestration complet en 8 waves avec 20+ agents specialises pour audit integral et polish customer-success d'un codebase**

## Version
v1

## Key Findings
- Skill cree a `~/.claude/skills/full-codebase-audit/SKILL.md` (invocable via `/full-codebase-audit`)
- 8 waves sequentielles avec max 5 agents paralleles par wave
- Utilise 30+ skills et 15+ types d'agents specialises
- Modes d'execution : complet, audit-only, polish-only, docs-only, module cible, fast
- Output structure dans `.audit/` avec rapport final score

## Architecture du Skill
| Wave | Nom | Agents | Objectif |
|------|-----|--------|----------|
| 0 | Discovery | 2 | Cartographier le codebase complet |
| 1 | Contract Integrity | 3 | Verifier backend <-> frontend <-> API spec |
| 2 | Deep Audit | 5 | Backend + Frontend + Security + A11y + Perf |
| 3 | Functional | 1-2 | Tests, types, lint, build |
| 4 | Customer Success | 3 | Analyse UX, design, produit |
| 5 | Polish | max 5/batch | Implementation des corrections P0/P1 |
| 6 | Documentation | 3 | OpenAPI, README, inline docs |
| 7 | Final Report | 2 | Rapport + anti-regression |

## Skills Orchestres
`/explore`, `/review`, `/workflow-clean-code`, `/quality-code-health:code-health`,
`/quality-debt-analysis:debt-analysis`, `/security-audit:audit`,
`/security-vulnerability-scan:vulnerability-scan`, `/senior-frontend`,
`/senior-backend`, `/web-quality-audit`, `/ui-design:accessibility-audit`,
`/performance-benchmark:benchmark`, `/senior-qa`, `/test-generator`,
`/ux-researcher-designer`, `/api-documenter`, `/readme-updater`,
`/crafting-effective-readmes`, `/utils-fix-errors`, `/workflow-review:review`

## Agents Utilises
`explore-codebase`, `fullstack-coordinator`, `code-reviewer`, `frontend-react`,
`backend-laravel`, `senior-backend`, `senior-frontend`, `security-specialist`,
`accessibility-specialist`, `performance-engineer`, `qa-testing`, `test-engineer`,
`customer-success`, `designer-ui-ux`, `product-manager`, `docs-writer`,
`technical-writer`, `regression-guard`, `tech-lead`

## Decisions Needed
None - le skill est operationnel

## Blockers
None

## Next Step
Invoquer `/full-codebase-audit` sur n'importe quel projet pour lancer l'audit complet

---
*Confidence: High*
*Iterations: 1*
