---

paths: "**/*.{sql,php}"
---

# Database Rules

## Agents to Use

| Task | Agent |
|------|-------|
| Schema design, modelisation | `database-admin` |
| Migrations, rollbacks | `migration-specialist` |
| Optimisation, performance | `database-admin` |
| Securite DB | `security-specialist` |

---

## Principes Fondamentaux

### Normalisation

- 3NF minimum pour les tables transactionnelles
- Denormaliser uniquement pour la performance (avec justification documentee)
- Chaque table a une **cle primaire** (UUID prefere pour les APIs)
- Relations definies avec des **foreign keys**

### Conventions de Nommage

| Element | Convention | Exemple |
|---------|-----------|---------|
| Table | snake_case, pluriel | `user_profiles` |
| Colonne | snake_case, singulier | `first_name` |
| Foreign key | `{table_singulier}_id` | `user_id` |
| Index | `idx_{table}_{colonnes}` | `idx_posts_user_id` |
| Unique | `uq_{table}_{colonnes}` | `uq_users_email` |
| Pivot table | Alphabetique, singulier | `post_tag` |

---

## Migrations

### Regles (NON-NEGOCIABLE)

- **NEVER** modifier une migration en production
- **ALWAYS** creer une nouvelle migration pour les changements
- **ALWAYS** inclure un rollback (`down()`) fonctionnel
- **ALWAYS** tester la migration + rollback avant merge
- **CRITICAL** : migration avant suppression de code

### Structure

```php
// OBLIGATOIRE : migration atomique, reversible
public function up(): void
{
    Schema::table('users', function (Blueprint $table) {
        $table->string('phone', 20)->nullable()->after('email');
        $table->index('phone');
    });
}

public function down(): void
{
    Schema::table('users', function (Blueprint $table) {
        $table->dropIndex(['phone']);
        $table->dropColumn('phone');
    });
}
```

### Zero-Downtime Migrations

Pour les tables a fort trafic :

1. **Ajouter** la nouvelle colonne (nullable)
2. **Deployer** le code qui ecrit dans les deux colonnes
3. **Migrer** les donnees existantes (batch)
4. **Deployer** le code qui lit la nouvelle colonne
5. **Supprimer** l'ancienne colonne

---

## Indexation

### Quand Indexer

| Situation | Action |
|-----------|--------|
| Colonne dans WHERE frequemment | Index simple |
| Combinaison de colonnes dans WHERE | Index composite |
| Colonne dans ORDER BY | Index |
| Foreign key | Index (automatique en PostgreSQL) |
| Colonne rarement filtree | Pas d'index |
| Table < 1000 lignes | Generalement pas d'index |

### Regles

```sql
-- OBLIGATOIRE : index sur les colonnes filtrees frequemment
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_user_created ON posts(user_id, created_at);

-- Index partiel (PostgreSQL) pour les cas courants
CREATE INDEX idx_orders_pending ON orders(created_at) WHERE status = 'pending';
```

- **TOUJOURS** analyser avec `EXPLAIN ANALYZE` avant d'ajouter un index
- **NEVER** indexer toutes les colonnes (overhead en ecriture)
- Index composite : colonnes les plus selectifs en premier

---

## Queries

### N+1 Prevention (CRITIQUE)

```php
// INTERDIT
$posts = Post::all();
foreach ($posts as $post) {
    $post->author->name; // 1 query par post
}

// OBLIGATOIRE
$posts = Post::with('author')->get();
```

### Select Specifique

```php
// OBLIGATOIRE : selectionner uniquement les colonnes necessaires
$users = User::select('id', 'name', 'email')->get();

// INTERDIT : tout charger
$users = User::all(); // SELECT *
```

### Pagination (OBLIGATOIRE pour les listes)

```php
// OBLIGATOIRE
$posts = Post::paginate(25); // max 100

// INTERDIT
$posts = Post::all(); // peut retourner des millions de lignes
```

### Bulk Operations

```php
// OBLIGATOIRE : batch pour les gros volumes
User::where('last_login', '<', now()->subYear())
    ->chunkById(1000, function ($users) {
        $users->each->markInactive();
    });

// INTERDIT : charger tout en memoire
$users = User::where('last_login', '<', now()->subYear())->get();
// -> OutOfMemory si > 100k lignes
```

---

## Transactions

```php
// OBLIGATOIRE pour les operations multi-tables
DB::transaction(function () use ($data) {
    $order = Order::create($data);
    $order->items()->createMany($data['items']);
    Payment::create(['order_id' => $order->id, ...]);
});

// Avec gestion d'erreur
DB::beginTransaction();
try {
    // operations...
    DB::commit();
} catch (Exception $e) {
    DB::rollBack();
    throw $e;
}
```

---

## Securite

| Mesure | Implementation |
|--------|---------------|
| SQL Injection | Requetes parametrees, Eloquent |
| Acces | RBAC via Policies, Row Level Security |
| Chiffrement | Colonnes sensibles chiffrees (encrypt) |
| Audit | Colonnes `created_at`, `updated_at`, `deleted_at` |
| Backup | Automatise, teste regulierement |
| Credentials | Via `.env`, jamais hardcode |

### Soft Deletes

```php
// Preferer le soft delete pour les donnees importantes
use SoftDeletes;
// Permet la recuperation et l'audit
```

---

## Types de Colonnes

| Donnee | Type PostgreSQL | Type MySQL |
|--------|----------------|------------|
| ID public | `uuid` | `char(36)` |
| ID interne | `bigInteger` auto | `bigint` auto |
| Texte court | `varchar(255)` | `varchar(255)` |
| Texte long | `text` | `text` |
| Montant | `decimal(10,2)` | `decimal(10,2)` |
| Boolean | `boolean` | `tinyint(1)` |
| Date/Time | `timestamptz` | `timestamp` |
| JSON | `jsonb` | `json` |
| Enum | `varchar` + check | `enum` |
| Status | `varchar(20)` | `varchar(20)` |

---

## Performance

| Technique | Quand |
|-----------|-------|
| Index | Colonnes filtrees/triees |
| Eager loading | Relations utilisees |
| Select specifique | Ne pas charger toutes les colonnes |
| Pagination | Toute liste |
| Cache | Donnees lues >> ecrites |
| Materialized views | Rapports complexes (PostgreSQL) |
| Connection pooling | Applications a fort trafic |
| Read replicas | Separation lecture/ecriture |

---

## Anti-Patterns (INTERDIT)

| Anti-Pattern | Correction |
|-------------|------------|
| Modifier migration en prod | Nouvelle migration |
| `SELECT *` partout | Select colonnes specifiques |
| Pas de pagination | `paginate()` avec limite |
| N+1 queries | Eager loading (`with`) |
| Pas de foreign keys | FK + constraints |
| Pas de rollback dans down() | Rollback complet |
| Charger tout en memoire | `chunk()` / `cursor()` |
| Pas de transaction multi-tables | `DB::transaction()` |
| Index sur toutes les colonnes | Analyser avec EXPLAIN |
| Donnees sensibles en clair | Chiffrement + masquage |
