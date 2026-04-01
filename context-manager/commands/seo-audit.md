---
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Task, TaskCreate, TaskUpdate, TaskList
argument-hint: <url-du-site>
description: Analyse SEO complète d'un site web — scrappe les pages publiques, audit technique, on-page, contenu, psychologie marketing, et SEO programmatique. Génère un rapport complet.
---

# Audit SEO Complet Automatisé

Lance une analyse SEO exhaustive du site fourni en paramètre.

**URL cible :** `$ARGUMENTS`

## Processus d'Exécution

Tu es un auditeur SEO expert. Tu dois analyser le site `$ARGUMENTS` en suivant rigoureusement le workflow défini dans `docs/marketing/WORKFLOW-SEO-COMPLET.md`.

### Étape 0 — Validation de l'URL et Préparation

1. Valider que `$ARGUMENTS` est une URL valide (commence par http:// ou https://)
2. Si ce n'est pas le cas, ajouter `https://` automatiquement
3. Stocker l'URL nettoyée comme `TARGET_URL`
4. Créer le répertoire de sortie du rapport :
   ```bash
   mkdir -p docs/audit-seo-$(date +%Y-%m-%d)
   ```
5. Lire le workflow de référence :
   ```
   Read docs/marketing/WORKFLOW-SEO-COMPLET.md
   ```

### Étape 1 — Découverte et Scraping (Phase 1-2 du Workflow)

Exécuter EN PARALLÈLE les collectes de données suivantes :

#### Agent 1 : Scraping de la Homepage
- WebFetch sur `TARGET_URL`
- Extraire : title, meta description, H1, structure des headings, liens internes, images, schema JSON-LD, hreflang, canonical, viewport meta

#### Agent 2 : Analyse robots.txt et Sitemap
- WebFetch sur `TARGET_URL/robots.txt`
- Identifier l'URL du sitemap
- WebFetch sur le sitemap XML
- Compter les URLs, vérifier la structure

#### Agent 3 : Headers HTTP et Sécurité
```bash
curl -sI -L "TARGET_URL" 2>/dev/null
```
- Extraire : status code, redirections, headers de sécurité (HSTS, X-Frame-Options, X-Content-Type-Options), Content-Type, cache headers

#### Agent 4 : Découverte des Pages Principales
- Depuis la homepage, identifier les liens internes principaux (navigation, footer)
- Scraper les 10-15 pages les plus importantes :
  - Page d'accueil
  - Pages de fonctionnalités/services
  - Page tarifs/pricing
  - Page à propos
  - Blog (page index)
  - Pages de contact
  - Mentions légales / CGU
  - Pages de catégories principales

#### Agent 5 : Recherche Concurrentielle
- WebSearch pour identifier les concurrents directs sur les mêmes mots-clés
- Collecter les 3-5 concurrents principaux

### Étape 2 — Analyse Technique (Phase 1 du Workflow)

Pour chaque page scrapée, analyser :

1. **Crawlabilité**
   - robots.txt : chemins bloqués vs autorisés
   - Sitemap : URLs listées vs pages découvertes
   - Architecture : profondeur de navigation (clics depuis homepage)
   - URLs : structure, longueur, lisibilité

2. **Indexation**
   - Meta robots par page
   - Canoniques (présence, cohérence)
   - Redirections (chaînes détectées via curl -L)

3. **Performance**
   - Analyser le poids des pages (via headers Content-Length)
   - Vérifier la présence de lazy loading
   - Vérifier la compression (Accept-Encoding)
   - Identifier les ressources bloquantes

4. **Mobile**
   - Viewport meta tag
   - Responsive hints dans le HTML

5. **Sécurité**
   - HTTPS
   - Headers de sécurité
   - Mixed content (HTTP dans HTTPS)

### Étape 3 — Analyse On-Page (Phase 2 du Workflow)

Pour chaque page scrapée :

| Élément | Vérification |
|---------|-------------|
| Title tag | Présent, unique, 50-60 chars, mot-clé inclus |
| Meta description | Présente, unique, 150-160 chars, CTA |
| H1 | Un seul, descriptif, mot-clé |
| Hiérarchie Headings | Logique, pas de sauts |
| Images | Alt text, format moderne, dimensions |
| Liens internes | Ancres descriptives, pas cassés |
| Schema JSON-LD | Types, validité |
| Hreflang | Présence, bidirectionnalité |
| Canonical | Présent, auto-référençant |
| Open Graph | Présent, complet |

### Étape 4 — Analyse de Contenu & E-E-A-T (Phase 4 du Workflow)

Pour les pages principales :

1. **Qualité du contenu**
   - Profondeur du sujet (nombre de mots, sous-sections)
   - Originalité (pas de contenu générique)
   - Lisibilité (longueur des paragraphes, clarté)
   - Satisfaction de l'intent

2. **E-E-A-T**
   - Bios auteur présentes ?
   - Page "À propos" détaillée ?
   - Politique éditoriale ?
   - Témoignages / preuves sociales ?
   - Certifications / badges de confiance ?
   - Mentions légales complètes ?

### Étape 5 — Analyse Psychologie Marketing (Phase 5 du Workflow)

Évaluer l'application des modèles psychologiques sur les pages de conversion :

1. **Page d'accueil / Landing**
   - Preuve sociale (chiffres, logos clients)
   - Proposition de valeur claire
   - Hiérarchie visuelle des CTA

2. **Page Pricing**
   - Ancrage (plan de référence)
   - Paradoxe du choix (nombre de plans)
   - Plan "Recommandé" mis en avant
   - Inversion du risque (essai gratuit, garantie)

3. **CTAs**
   - Déclencheurs émotionnels
   - Aversion à la perte
   - Urgence (éthique vs manipulation)

4. **Parcours de conversion**
   - Friction identifiée
   - Étapes superflues
   - Points d'abandon potentiels

Scorer chaque modèle applicable avec le **PLFS** (Psychological Leverage & Feasibility Score).

### Étape 6 — Analyse SEO Programmatique (Phase 6 du Workflow)

1. Identifier les patterns de pages répétitives (par ville, par catégorie, par spécialité, etc.)
2. Calculer le **Feasibility Index** (0-100)
3. Identifier les playbooks applicables parmi les 12 du workflow
4. Évaluer la qualité actuelle des pages programmatiques existantes

### Étape 7 — Détection de Cannibalisation (Phase 7 du Workflow)

1. Grouper les pages par thématique/mot-clé cible
2. Identifier les pages qui visent le même intent
3. Vérifier les title tags similaires
4. Proposer des résolutions (consolider, différencier, canonical)

### Étape 8 — Analyse des Mots-Clés (Phase 3 du Workflow)

1. WebSearch pour identifier les mots-clés du site (site:domain.com + thématiques)
2. Identifier les clusters de mots-clés principaux
3. Mapper les mots-clés aux pages existantes
4. Identifier les gaps (mots-clés sans page)

## Étape 9 — Remédiation Technique Automatique

**IMPORTANT : Cette étape applique directement les corrections techniques faisables.**

Après l'analyse, si le site audité correspond au codebase courant (le projet dans lequel la commande est exécutée), appliquer automatiquement les remédiations techniques suivantes :

### 9.1 Remédiations Automatiques (Appliquées sans Demander)

Ces corrections sont **sans risque** et **réversibles** (git revert) :

#### Meta Tags & SEO On-Page
- Corriger/ajouter les balises `<title>` manquantes ou trop longues/courtes
- Corriger/ajouter les `<meta name="description">` manquantes ou mal formatées
- Ajouter les balises `<meta name="robots">` manquantes
- Ajouter les `<link rel="canonical">` auto-référençantes manquantes
- Corriger la hiérarchie des headings (H1 multiples, sauts de niveaux)
- Ajouter les attributs `alt` manquants sur les images
- Ajouter `loading="lazy"` sur les images sous le fold
- Ajouter `width` et `height` manquants sur les images

#### Données Structurées
- Ajouter/corriger le schema JSON-LD `Organization` sur la homepage
- Ajouter le schema `BreadcrumbList` si le fil d'Ariane existe visuellement
- Ajouter le schema `FAQPage` sur les pages contenant des sections FAQ
- Ajouter le schema `Article`/`BlogPosting` sur les articles de blog

#### SEO International
- Ajouter/corriger les balises `hreflang` manquantes ou incohérentes
- Ajouter l'attribut `lang` sur `<html>` si manquant

#### Open Graph & Social
- Ajouter les balises `og:title`, `og:description`, `og:image`, `og:url` manquantes
- Ajouter les balises `twitter:card`, `twitter:title`, `twitter:description` manquantes

#### Fichiers Techniques
- Corriger `robots.txt` si des chemins importants sont bloqués par erreur
- Ajouter la directive `Sitemap:` dans `robots.txt` si manquante
- Corriger/enrichir le sitemap XML si des pages importantes sont absentes

#### Sécurité (Headers)
Si le projet a un fichier de configuration serveur accessible (nginx.conf, .htaccess, next.config.js, etc.) :
- Ajouter les headers de sécurité manquants (HSTS, X-Content-Type-Options, X-Frame-Options)
- Forcer HTTPS si des liens internes utilisent HTTP

#### Performance
- Convertir les imports d'images vers des formats modernes si le build system le supporte
- Ajouter `rel="preload"` pour les ressources critiques identifiées
- Ajouter `rel="preconnect"` pour les domaines tiers critiques

### 9.2 Remédiations Semi-Automatiques (Proposées avec Diff)

Ces corrections nécessitent une **validation humaine** car elles modifient le contenu visible :

- **Réécriture des title tags** — Proposer les nouveaux titles avec déclencheurs psychologiques, montrer le diff avant/après
- **Réécriture des meta descriptions** — Proposer les nouvelles descriptions avec CTA, montrer le diff
- **Restructuration du maillage interne** — Proposer les nouveaux liens à ajouter avec leurs ancres
- **Correction de cannibalisation** — Proposer les consolidations/différenciations avec les redirections 301

### 9.3 Rapport de Remédiation Technique

Pour chaque correction appliquée, documenter :

```
Fichier modifié : [chemin]
Type : [auto/semi-auto]
Avant : [code original]
Après : [code modifié]
Raison : [issue #N du rapport]
Impact score estimé : +___ pts
```

Générer un fichier séparé `docs/audit-seo-{date}/REMEDIATION-TECHNIQUE.md` listant TOUTES les modifications effectuées, pour faciliter la revue et le rollback si nécessaire.

### 9.4 Remédiations Manuelles Requises (Humain)

Lister clairement dans le rapport les remédiations qui ne peuvent PAS être automatisées :

| Catégorie | Exemples | Pourquoi Manuel |
|-----------|----------|----------------|
| **Contenu éditorial** | Enrichir les articles, ajouter des études de cas | Nécessite expertise métier |
| **E-E-A-T** | Rédiger les bios auteur, créer la page À propos | Contenu personnel |
| **Backlinks** | Guest posting, partenariats, PR | Relations humaines |
| **Psychologie Marketing** | Redesign de la page pricing, test A/B | Décisions business |
| **SEO Programmatique** | Création de nouvelles catégories de pages | Décision stratégique |
| **Design/UX** | Taille des cibles tactiles, responsive | Nécessite design review |

---

## Format du Rapport Final

Générer le rapport dans `docs/audit-seo-{date}/RAPPORT-SEO.md` avec cette structure EXACTE :

```markdown
# Rapport d'Audit SEO — {domaine}

**Date :** {date}
**URL :** {url}
**Auditeur :** Claude Code (Audit Automatisé)

---

## Résumé Exécutif
{2-3 paragraphes : état de santé, forces, faiblesses, 3 priorités}

## SEO Health Index
{Tableau scoré selon le workflow — 5 catégories, score pondéré}

## Métriques Clés
{Tableau des métriques observées}

## Forces Identifiées
{Top 5 forces avec impact et phase}

## Issues Identifiées
{Classées par sévérité — Critique > Haute > Moyenne > Basse}
{Pour chaque issue : description, catégorie, evidence, sévérité, recommandation}

## Analyse Technique Détaillée
{Crawlabilité, indexation, performance, mobile, sécurité}

## Analyse On-Page
{Par page : title, meta, headings, images, schema, maillage}

## Analyse de Contenu & E-E-A-T
{Scorecard qualité, audit E-E-A-T}

## Analyse Psychologie Marketing
{Modèles appliqués, PLFS scores, recommandations par funnel stage}

## SEO Programmatique
{Feasibility Index, playbooks applicables, recommandations}

## Cannibalisation
{Conflits détectés, résolutions proposées}

## Stratégie de Mots-Clés
{Clusters identifiés, gaps, opportunités}

## Remédiations Techniques Appliquées
{Liste de TOUTES les modifications effectuées automatiquement}
{Pour chaque : fichier, avant/après, raison, impact score}

## Remédiations Semi-Automatiques Proposées
{Diffs proposés pour validation humaine}
{Title tags, meta descriptions, maillage, cannibalisation}

## Plan d'Action Priorisé — Remédiations Manuelles (Humain)
### 1. Bloqueurs Critiques (Semaine 1-2)
### 2. Fort Impact (Semaines 3-6)
### 3. Quick Wins
### 4. Long Terme
{Chaque action inclut : description, pages concernées, effort estimé, impact score}

## Workflow de Remédiation Manuelle
{Sprint 0 à 7 pré-rempli avec les tâches concrètes NON automatisables}
{Assignations, DoD, dépendances}

## Annexes
- Pages scrapées et données brutes
- Matrice de mots-clés
- Carte de cannibalisation
- Log complet des remédiations techniques appliquées
```

## Règles d'Exécution

1. **Paralléliser au maximum** — Lancer les agents de scraping en parallèle
2. **Ne jamais inventer de données** — Si une donnée n'est pas accessible, le noter clairement
3. **Scorer rigoureusement** — Utiliser les grilles du workflow (déductions par sévérité)
4. **Être actionnable** — Chaque issue doit avoir une recommandation concrète
5. **Respecter l'éthique** — Les recommandations psychologiques doivent passer le test éthique
6. **Langue** — Tout le rapport en français
7. **Pas de TODO** — Le rapport doit être complet, pas de placeholder
8. **Remédiation technique AUTO** — Si le site audité correspond au codebase courant, appliquer les corrections techniques automatiques (Étape 9.1) DIRECTEMENT dans le code
9. **Remédiation semi-auto** — Proposer les diffs pour les corrections semi-automatiques et attendre validation
10. **Remédiation manuelle** — Lister clairement tout ce qui nécessite une intervention humaine dans le rapport

## Détection du Codebase Local

Pour déterminer si le site audité correspond au codebase courant :

1. Extraire le domaine de `TARGET_URL`
2. Chercher ce domaine dans les fichiers de config du projet :
   ```bash
   grep -r "TARGET_DOMAIN" .env* config/ *.config.* package.json composer.json 2>/dev/null
   ```
3. Si le domaine est trouvé → **MODE REMÉDIATION ACTIVE** : appliquer les corrections dans le code
4. Sinon → **MODE RAPPORT SEUL** : générer uniquement le rapport avec les recommandations

En mode remédiation active, créer une branche dédiée :
```bash
git checkout -b seo-remediation-$(date +%Y%m%d)
```

## Outils Disponibles

- **WebFetch** — Scraping des pages publiques
- **WebSearch** — Recherche concurrentielle et mots-clés
- **Bash (curl)** — Headers HTTP, robots.txt, redirections, git
- **Task** — Agents parallèles pour analyses spécialisées
- **Write** — Génération du rapport final
- **Edit** — Corrections techniques dans le code (mode remédiation)
- **Glob/Grep** — Recherche dans le codebase pour la remédiation
- **Read** — Lecture des fichiers à corriger

## Fichiers de Sortie

| Fichier | Contenu |
|---------|---------|
| `docs/audit-seo-{date}/RAPPORT-SEO.md` | Rapport d'audit complet |
| `docs/audit-seo-{date}/REMEDIATION-TECHNIQUE.md` | Log de toutes les corrections automatiques appliquées |
| `docs/audit-seo-{date}/REMEDIATION-MANUELLE.md` | Plan d'action pour les remédiations humaines (sprints, assignations, DoD) |
| `docs/audit-seo-{date}/DONNEES-BRUTES.md` | Données scrapées et métriques brutes |

## Lancement

Commencer IMMÉDIATEMENT l'audit du site `$ARGUMENTS`. Ne pas demander de confirmation. Exécuter toutes les étapes du workflow, appliquer les remédiations techniques automatiques si applicable, et générer tous les rapports.
