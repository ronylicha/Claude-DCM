---

paths: "**/*.php"
---

# Laravel Backend Rules

## Stack

- Laravel 11/12
- PHP 8.2+ (strict types)
- PostgreSQL / MySQL
- Sanctum (SPA/API auth) / Passport (OAuth)
- Redis (cache, queues, sessions)

## Commands

```bash
composer test        # Run tests
php artisan migrate  # Run migrations
composer lint        # Lint code (Pint)
php artisan tinker   # REPL
php artisan route:list # List routes
```

## Agents to Use

| Task                        | Agent                                    |
| --------------------------- | ---------------------------------------- |
| Database schema, migrations | `database-admin`, `migration-specialist` |
| API endpoints, validation   | `laravel-api`                            |
| Services, business logic    | `backend-laravel`                        |
| Security audit              | `security-specialist`                    |
| Performance, debugging      | `performance-engineer`                   |
| Code review                 | `code-reviewer`                          |

## Key Rules

- **NEVER** modify existing migrations in production
- **ALWAYS** validate input with Form Requests
- **ALWAYS** use Resources pour les reponses API
- **ALWAYS** utiliser `declare(strict_types=1)` en haut de chaque fichier
- **CRITICAL**: Contracts definis par `tech-lead` AVANT implementation

## API Contract Enforcement

- Tout changement d'interface API -> Validation par `tech-lead`
- Breaking change -> STOP + Escalate vers `project-supervisor`
- Modification de contrat -> Mise a jour synchrone Front + Back

---

## Architecture

### Principe : Controllers Fins

```php
// INTERDIT : logique metier dans le controller
public function store(Request $request) {
    $user = User::create($request->all()); // INTERDIT
    Mail::send(...);
    // 50 lignes de logique...
}

// OBLIGATOIRE : deleguer au Service
public function store(StoreUserRequest $request): JsonResponse {
    $user = $this->userService->create($request->validated());
    return new UserResource($user);
}
```

### Structure des Fichiers

```
app/
├── Http/
│   ├── Controllers/     # Fins, delegation aux Services
│   ├── Requests/        # FormRequest (validation)
│   ├── Resources/       # API Resources (transformation)
│   └── Middleware/
├── Models/              # Eloquent, relations, scopes
├── Services/            # Logique metier
├── Policies/            # Autorisation
├── Jobs/                # Queues, taches lourdes
├── Events/              # Evenements domaine
├── Listeners/           # Reactions aux evenements
├── Actions/             # Actions atomiques (optionnel)
└── Enums/               # PHP 8.1+ backed enums
```

### Regles d'Architecture

| Couche | Responsabilite | Interdit |
|--------|---------------|----------|
| Controller | Recevoir, valider, repondre | Logique metier, queries DB |
| FormRequest | Validation + autorisation | Logique metier |
| Service | Logique metier, orchestration | Acces direct a `$request` |
| Model | Relations, scopes, accessors | Logique metier complexe |
| Resource | Transformation API | Logique, queries |
| Policy | Autorisation (can/cannot) | Logique metier |
| Job | Taches asynchrones | Reponses HTTP |

---

## Eloquent & Database

### N+1 : Detection et Prevention (CRITIQUE)

```php
// INTERDIT : N+1 queries
$posts = Post::all();
foreach ($posts as $post) {
    echo $post->author->name; // 1 query par post !
}

// OBLIGATOIRE : eager loading
$posts = Post::with('author')->get();

// Ou au niveau du modele
protected $with = ['author'];
```

### Query Scopes (reutilisables)

```php
// Dans le Model
public function scopeActive(Builder $query): Builder {
    return $query->where('status', 'active');
}

public function scopeRecent(Builder $query, int $days = 7): Builder {
    return $query->where('created_at', '>=', now()->subDays($days));
}

// Usage
$posts = Post::active()->recent(30)->get();
```

### Transactions (operations critiques)

```php
DB::transaction(function () use ($data) {
    $order = Order::create($data);
    $order->items()->createMany($data['items']);
    event(new OrderCreated($order));
});
```

### Regles Eloquent

- **TOUJOURS** definir `$fillable` ou `$guarded` sur chaque modele
- **NEVER** `$request->all()` dans `create()` ou `update()`
- **TOUJOURS** utiliser les transactions pour les operations multi-tables
- Preferer les query scopes aux requetes en dur dans les controllers
- Eviter les raw queries sauf cas de performance avere

---

## Validation - FormRequest

```php
class StorePostRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Post::class);
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'min:3', 'max:255'],
            'content' => ['required', 'string', 'min:10'],
            'category_id' => ['required', 'exists:categories,id'],
            'tags' => ['sometimes', 'array', 'max:10'],
            'tags.*' => ['string', 'max:50'],
        ];
    }

    public function messages(): array
    {
        return [
            'title.required' => 'Le titre est obligatoire.',
        ];
    }
}
```

---

## API Resources

```php
class PostResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'excerpt' => Str::limit($this->content, 200),
            'author' => new UserResource($this->whenLoaded('author')),
            'tags' => TagResource::collection($this->whenLoaded('tags')),
            'created_at' => $this->created_at->toISOString(),
        ];
    }
}
```

### Format de Reponse Standard

```php
// Succes
return PostResource::collection($posts)
    ->additional(['meta' => ['total' => $posts->total()]]);

// Erreur
return response()->json([
    'message' => 'Validation failed',
    'errors' => $validator->errors(),
], 422);
```

### Codes HTTP

| Code | Usage |
|------|-------|
| 200 | Succes (GET, PUT, PATCH) |
| 201 | Cree avec succes (POST) |
| 204 | Succes sans contenu (DELETE) |
| 400 | Requete invalide |
| 401 | Non authentifie |
| 403 | Non autorise |
| 404 | Ressource introuvable |
| 422 | Erreur de validation |
| 429 | Rate limit depasse |
| 500 | Erreur serveur |

---

## Authentification & Autorisation

### Sanctum (SPA/API)

- Utiliser les tokens Sanctum pour les API
- Utiliser les cookies de session pour les SPA
- **NEVER** exposer de donnees sensibles dans les reponses

### Policies

```php
class PostPolicy
{
    public function update(User $user, Post $post): bool
    {
        return $user->id === $post->user_id;
    }

    public function delete(User $user, Post $post): bool
    {
        return $user->id === $post->user_id || $user->isAdmin();
    }
}

// Usage dans le controller
$this->authorize('update', $post);
```

---

## Queues & Jobs

- **TOUJOURS** offloader les operations lourdes (emails, PDF, imports)
- Assurer l'idempotence des jobs
- Utiliser `ShouldQueue` pour les listeners non-critiques
- Implementer `tries`, `backoff`, `timeout`

```php
class ProcessImport implements ShouldQueue
{
    public int $tries = 3;
    public int $backoff = 60;
    public int $timeout = 120;

    public function handle(): void { /* ... */ }

    public function failed(Throwable $exception): void
    {
        // Notifier, logger...
    }
}
```

---

## Caching

```php
// Cache avec TTL
$posts = Cache::remember('posts:featured', 3600, function () {
    return Post::with('author')->featured()->get();
});

// Invalidation
Cache::forget('posts:featured');

// Cache tags (Redis requis)
Cache::tags(['posts'])->flush();
```

---

## Routes

### Conventions

```php
// Grouper logiquement
Route::prefix('api/v1')->middleware('auth:sanctum')->group(function () {
    Route::apiResource('posts', PostController::class);
    Route::post('posts/{post}/publish', [PostController::class, 'publish']);
});
```

### Route Model Binding

```php
// Automatique
Route::get('/posts/{post}', [PostController::class, 'show']);

// Le controller recoit directement le modele
public function show(Post $post): PostResource {
    return new PostResource($post->load('author'));
}
```

---

## Performance

| Technique | Quand |
|-----------|-------|
| Eager loading (`with`) | Toujours pour les relations |
| Lazy loading prevention | `Model::preventLazyLoading()` en dev |
| Chunking | Boucles sur > 1000 enregistrements |
| Select specifique | Ne pas charger toutes les colonnes |
| Index DB | Colonnes filtrees/triees frequemment |
| Queue | Operations > 500ms |
| Cache | Donnees lues souvent, ecrites rarement |

---

## Anti-Patterns (INTERDIT)

| Anti-Pattern | Correction |
|-------------|------------|
| Fat controllers | Deleguer aux Services |
| `$request->all()` dans create/update | `$request->validated()` |
| Logique metier dans les routes | Utiliser des Controllers |
| Classes Service massives | Decouper en Actions/Services cibles |
| Mass assignment sans protection | Definir `$fillable` |
| Valeurs hardcodees | Config/env files |
| Logique dupliquee entre controllers | Extraire dans un Service |
| Raw queries sans raison | Eloquent Builder |
| N+1 queries | Eager loading |
| Jobs non-idempotents | Verifier avant d'executer |
