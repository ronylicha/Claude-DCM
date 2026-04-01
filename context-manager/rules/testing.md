# Testing Rules

## Agents to Use

| Task | Agent |
|------|-------|
| Strategie de tests | `qa-testing` |
| Tests unitaires/integration | `test-engineer` |
| Execution des tests | `test-runner` |
| Analyse de couverture | `test-runner` |
| Tests E2E | `qa-testing` |

## Coverage Minimum

| Type | Objectif |
|------|----------|
| Global | >= 80% |
| Chemins critiques (auth, paiement) | 100% |
| Nouveau code | >= 90% |
| Hotfix | Test de non-regression obligatoire |

---

## Principes

### Test Behavior, Not Implementation

- Tester ce que le code **fait**, pas **comment** il le fait
- Les tests doivent survivre a un refactoring interne
- Tester du point de vue de l'utilisateur

### Pattern AAA (Arrange, Act, Assert)

```typescript
test('calculates total with discount', () => {
  // Arrange
  const items = [{ price: 100 }, { price: 50 }];
  const discount = 0.1;

  // Act
  const total = calculateTotal(items, discount);

  // Assert
  expect(total).toBe(135);
});
```

### Nommage Descriptif

```
OBLIGATOIRE :
  'returns 404 when user does not exist'
  'sends email notification on order completion'
  'prevents duplicate submissions within 5 seconds'

INTERDIT :
  'works'
  'test 1'
  'should work correctly'
```

---

## Types de Tests

### Tests Unitaires

- 1 fonction/methode = 1 suite de tests
- Mocker les dependances externes
- Rapides (< 100ms par test)
- Isoles (pas d'etat partage)

```typescript
// Jest / Vitest
describe('UserService', () => {
  describe('create', () => {
    it('creates user with hashed password', async () => {
      const user = await userService.create({
        email: 'test@example.com',
        password: 'secret',
      });
      expect(user.password).not.toBe('secret');
      expect(user.email).toBe('test@example.com');
    });

    it('throws on duplicate email', async () => {
      await userService.create({ email: 'test@example.com', password: 'secret' });
      await expect(
        userService.create({ email: 'test@example.com', password: 'other' })
      ).rejects.toThrow('Email already exists');
    });
  });
});
```

### Tests d'Integration

- Tester les interactions entre composants
- Base de donnees de test (seeded)
- API endpoints complets
- Nettoyer les donnees entre les tests

```php
// Laravel Feature Test
class PostApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_authenticated_user_can_create_post(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)
            ->postJson('/api/v1/posts', [
                'title' => 'Test Post',
                'content' => 'Test content here',
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.title', 'Test Post');

        $this->assertDatabaseHas('posts', [
            'title' => 'Test Post',
            'user_id' => $user->id,
        ]);
    }
}
```

### Tests de Composants (React)

```tsx
// React Testing Library
import { render, screen, fireEvent } from '@testing-library/react';

describe('LoginForm', () => {
  it('shows error on invalid email', async () => {
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Email invalide')).toBeInTheDocument();
  });

  it('submits form with valid data', async () => {
    const onSubmit = jest.fn();
    render(<LoginForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    });
  });
});
```

### Tests E2E

- Playwright ou Cypress
- Scenarios utilisateur complets
- Environnement isole
- Donnes de test deterministes

---

## Cas a Toujours Tester

| Categorie | Cas |
|-----------|-----|
| Happy path | Scenario nominal |
| Erreur | Input invalide, timeout, 500 |
| Limites | Liste vide, 1 element, max elements |
| Auth | Non authentifie, pas de permission, token expire |
| Concurrence | Double soumission, race conditions |
| Donnees | Null, undefined, string vide, caracteres speciaux |

---

## Mocking

### Quand Mocker

| Mocker | Ne pas mocker |
|--------|--------------|
| APIs externes | Logique interne |
| Base de donnees (unitaire) | Base de donnees (integration) |
| Services tiers (Stripe, S3) | Utilitaires simples |
| Timers/dates | Calculs purs |

### Patterns

```typescript
// Mock d'un service
jest.mock('./emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
}));

// Mock d'une date
jest.useFakeTimers();
jest.setSystemTime(new Date('2024-01-01'));

// Mock d'un module natif React Native
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
```

---

## Workflow de Test

```
Avant modification -> Verifier tests existants passent
Pendant implementation -> TDD si possible (red-green-refactor)
Apres modification -> Tous les tests passent + nouveaux tests
Avant merge -> Suite complete + coverage check
```

---

## Anti-Patterns (INTERDIT)

| Anti-Pattern | Correction |
|-------------|------------|
| Tests qui dependent de l'ordre | Tests isoles |
| Etat partage entre tests | Setup/teardown propre |
| Tests fragiles (implementation detail) | Tester le comportement |
| Pas de test avant modification | Test de non-regression d'abord |
| Sleep/timeout dans les tests | Utiliser waitFor/polling |
| Assertions manquantes | Au moins 1 assertion par test |
| Tests commentes/skipped | Corriger ou supprimer |
| Mocks excessifs | Tester avec les vrais composants quand possible |
