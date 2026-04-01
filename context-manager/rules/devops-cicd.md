# DevOps & CI/CD Rules

## Agents to Use

| Task | Agent |
|------|-------|
| CI/CD, pipelines | `devops-infra` |
| Deployment, infra | `devops-infra` |
| Troubleshooting, incidents | `devops-troubleshooter` |
| Monitoring, alerting | `devops-infra` |
| Securite infra | `security-specialist` |

---

## Docker

### Regles de Base

- **ALWAYS** utiliser des images officielles comme base
- **ALWAYS** specifier la version exacte du tag (`node:20.11-alpine`, pas `node:latest`)
- **ALWAYS** utiliser un utilisateur non-root dans le conteneur
- **NEVER** copier `.env`, secrets, ou `node_modules` dans l'image
- **ALWAYS** utiliser un `.dockerignore`

### Multi-Stage Build (OBLIGATOIRE pour la prod)

```dockerfile
# Stage 1: Build
FROM node:20.11-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Stage 2: Production
FROM node:20.11-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 -S app && adduser -S app -u 1001
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### Docker Compose (Dev)

```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    volumes: ["./src:/app/src"]
    env_file: .env
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

---

## CI/CD Pipeline

### Structure Standard (GitHub Actions)

```yaml
name: CI/CD
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm lint

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - run: pnpm build

  deploy-staging:
    if: github.ref == 'refs/heads/develop'
    needs: build
    # ...

  deploy-production:
    if: github.ref == 'refs/heads/main'
    needs: build
    # ...
```

### Etapes Obligatoires (dans cet ordre)

1. **Lint** : ESLint, Pint (PHP), formatage
2. **Type check** : `tsc --noEmit` (TypeScript)
3. **Tests unitaires** : avec coverage >= 80%
4. **Tests integration** : API, DB
5. **Build** : production build
6. **Security scan** : `npm audit`, `composer audit`, Snyk
7. **Deploy staging** : sur `develop`
8. **Deploy production** : sur `main` (apres review)

---

## Deployment

### Strategies

| Strategie | Quand | Risque |
|-----------|-------|--------|
| **Rolling** | Mises a jour standard | Faible |
| **Blue/Green** | Zero-downtime requis | Moyen |
| **Canary** | Features risquees | Faible |
| **Recreate** | Dev/staging uniquement | Eleve |

### Regles de Deployment

- **NEVER** deployer en prod un vendredi (sauf hotfix critique)
- **ALWAYS** avoir un rollback plan teste
- **ALWAYS** verifier les health checks apres deploy
- **ALWAYS** notifier l'equipe avant un deploy prod
- **NEVER** deployer sans que tous les tests passent
- **NEVER** deployer sans review sur `main`

### Rollback

```bash
# Rollback rapide
git revert HEAD --no-edit && git push

# Rollback a un commit specifique
git revert --no-commit HEAD~3..HEAD && git commit -m "rollback: revert to v1.2.3"
```

---

## Monitoring & Alerting

### Metriques a Surveiller

| Categorie | Metriques | Seuil d'alerte |
|-----------|-----------|----------------|
| Disponibilite | Uptime | < 99.9% |
| Performance | Response time (p95) | > 500ms |
| Erreurs | Error rate (5xx) | > 1% |
| Resources | CPU usage | > 80% |
| Resources | Memory usage | > 85% |
| Resources | Disk usage | > 90% |
| DB | Connection pool | > 80% utilise |
| DB | Slow queries | > 1s |

### Health Checks

```
GET /health          → 200 OK (basique, pour load balancer)
GET /health/ready    → 200 OK (app + DB + cache ready)
GET /health/live     → 200 OK (processus vivant)
```

---

## Environnements

| Env | Branche | Deploy | Donnees |
|-----|---------|--------|---------|
| **Local** | feature/* | Manuel | Seeders/fixtures |
| **Staging** | develop | Auto (CI) | Copie anonymisee prod |
| **Production** | main | Manuel (apres review) | Reelles |

---

## Secrets Management

- **NEVER** stocker de secrets dans le code ou les images Docker
- **ALWAYS** utiliser des variables d'environnement ou un secret manager
- Rotation des secrets tous les 90 jours minimum
- Secrets differents par environnement
- Audit des acces aux secrets

---

## Infrastructure as Code

- Definir l'infra en code (Terraform, Pulumi, CDK)
- Versionner les configs d'infra dans Git
- Review les changements d'infra comme du code
- Tester les changements en staging avant prod

---

## Anti-Patterns (INTERDIT)

| Anti-Pattern | Correction |
|-------------|------------|
| `latest` tag Docker | Version exacte |
| Root dans le conteneur | Utilisateur non-root |
| Secrets dans le code | Variables d'env / secret manager |
| Deploy prod sans tests | Pipeline CI obligatoire |
| Deploy vendredi soir | Lundi-jeudi |
| Pas de health check | `/health` endpoint |
| Pas de rollback plan | Plan teste avant deploy |
| Logs en texte brut | Logs structures (JSON) |
| Pas de monitoring | Alertes sur metriques critiques |
| `docker-compose` en prod | Orchestrateur (K8s, ECS, etc.) |
