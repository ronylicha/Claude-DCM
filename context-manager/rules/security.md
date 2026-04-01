# Security Rules

## Pre-Modification Checklist

Before modifying any file:

1. List existing functions/methods
2. Identify incoming dependencies: `grep -r 'import.*from.*{fichier}' . || grep -r 'use App.*{classe}' .`
3. Identify outgoing dependencies (what this file calls)
4. Check existing tests covering this file
5. If public API impact -> Alert + `tech-lead` validation
6. If no existing test -> Create non-regression test BEFORE modification

## Compliance Agents

| Compliance | Agent |
|------------|-------|
| General security | `security-specialist` |
| RGPD/Privacy | `gdpr-dpo` |
| Legal/Regulations | `legal-compliance` |
| Contracts (CGV, SLA) | `contract-manager` |
| Security audit | `security-auditor` |

---

## Principes Fondamentaux

### Defense en Profondeur
Appliquer **plusieurs couches** de controles de securite. Ne jamais compter sur un seul mecanisme.

### Zero Trust
Ne jamais faire confiance, toujours verifier. Verifier chaque requete d'acces, quelle que soit l'origine.

### Moindre Privilege
Accorder le **minimum** d'acces necessaire. Revoquer les permissions inutilisees.

### Security by Design
Integrer la securite des les premieres etapes de conception, pas en retrospective.

---

## Regles Critiques (NON-NEGOCIABLE)

### Secrets & Configuration

- **NEVER** commit `.env`, credentials, API keys, tokens
- **NEVER** hardcoder des secrets dans le code source
- **ALWAYS** utiliser des variables d'environnement ou un secret manager
- **ALWAYS** ajouter `.env`, `*.key`, `*.pem` dans `.gitignore`

### Input Validation

- **ALWAYS** valider toutes les entrees utilisateur (Zod, FormRequest, schemas)
- **ALWAYS** utiliser des requetes parametrees (prevent SQL injection)
- **ALWAYS** encoder les sorties HTML (prevent XSS)
- **NEVER** faire confiance aux donnees du client

### Erreurs & Logging

- **NEVER** exposer les erreurs internes aux clients (stack traces, SQL)
- **NEVER** logger des donnees sensibles (passwords, tokens, PII)
- **ALWAYS** retourner des messages d'erreur generiques en production
- **ALWAYS** logger les tentatives d'acces non autorisees

### Authentification

- **ALWAYS** hasher les mots de passe (bcrypt/argon2)
- **ALWAYS** implementer MFA pour les comptes admin
- **ALWAYS** limiter les tentatives de connexion (rate limiting)
- **NEVER** stocker des mots de passe en clair
- **NEVER** envoyer des tokens dans les URL (query params)

### Autorisation

- **ALWAYS** verifier les permissions cote serveur
- **ALWAYS** utiliser des Policies/Gates (Laravel) ou middleware
- **NEVER** se fier uniquement aux controles frontend

---

## OWASP Top 10 - Checklist

| # | Vulnerabilite | Prevention |
|---|---------------|------------|
| A01 | Broken Access Control | Policies, middleware auth, RBAC |
| A02 | Cryptographic Failures | TLS 1.2+, AES-256, bcrypt |
| A03 | Injection (SQL, XSS, CMD) | Requetes parametrees, encodage, validation |
| A04 | Insecure Design | Threat modeling, security by design |
| A05 | Security Misconfiguration | Defaults securises, headers, CORS restrictif |
| A06 | Vulnerable Components | Dependances a jour, audit `npm audit`, `composer audit` |
| A07 | Auth Failures | MFA, rate limiting, session management |
| A08 | Data Integrity Failures | Signatures, checksums, CI/CD securise |
| A09 | Logging & Monitoring | Logs centralises, alertes, audit trail |
| A10 | SSRF | Validation d'URL, whitelist de domaines |

---

## Headers de Securite

```
Content-Security-Policy: default-src 'self'; script-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains (ATTENTION: impact durable)
```

---

## API Security

| Mesure | Implementation |
|--------|---------------|
| Auth | Bearer tokens (Sanctum/JWT), OAuth2 |
| Rate limiting | `throttle` middleware, par IP et par user |
| CORS | Whitelist stricte des origines autorisees |
| Input validation | Schema validation (Zod, FormRequest) |
| Pagination | Limiter `per_page` max (ex: 100) |
| Mass assignment | `$fillable` / `$guarded` explicites |
| Versioning | Prefixer les routes `/api/v1/` |

---

## Gestion des Dependances

- **TOUJOURS** auditer les dependances regulierement
  - `npm audit` / `pnpm audit` (frontend)
  - `composer audit` (PHP)
- **TOUJOURS** mettre a jour les dependances avec des vulnerabilites connues
- **NEVER** utiliser des packages non-maintenus en production
- Utiliser Snyk, Dependabot, ou Renovate pour le monitoring continu

---

## Donnees Sensibles

### Classification

| Niveau | Exemples | Traitement |
|--------|----------|------------|
| Critique | Passwords, API keys, tokens | Chiffrer, ne jamais logger |
| Confidentiel | Email, telephone, adresse | Chiffrer au repos, acces restreint |
| Interne | Metriques, configs | Acces controle |
| Public | Documentation, marketing | Libre |

### RGPD / Protection des Donnees

- Minimisation des donnees : ne collecter que le necessaire
- Consentement explicite pour le traitement
- Droit a l'oubli : capacite de suppression complete
- Registre de traitement des donnees
- Privacy Impact Assessment pour les nouveaux traitements

---

## Incident Response

### Severite

| Niveau | Description | Reponse |
|--------|-------------|---------|
| P0 | Breach active, exfiltration | Immediate, 24/7 |
| P1 | Acces non autorise confirme | < 1h |
| P2 | Activite suspecte, malware | < 4h |
| P3 | Tentatives echouees | < 24h |

### Workflow

```
Detection -> Triage (P0-P3) -> Confinement -> Eradication -> Recuperation -> Post-mortem
```

---

## Anti-Patterns (INTERDIT)

| Anti-Pattern | Correction |
|-------------|------------|
| `.env` dans le repo | `.gitignore` + secret manager |
| Erreurs internes exposees | Messages generiques en prod |
| `SELECT *` sans controle d'acces | Policies + select specifique |
| Mots de passe en clair | bcrypt/argon2 |
| Token dans l'URL | Header Authorization |
| CORS `*` en production | Whitelist stricte |
| Pas de rate limiting | `throttle` middleware |
| Dependances non auditees | npm/composer audit + Snyk |
| Logs avec PII | Masquer/exclure les donnees sensibles |
