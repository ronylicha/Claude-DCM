---
name: nextjs-best-practices
description: Next.js 14+ App Router mastery. Server Components, data fetching, routing patterns, streaming, parallel routes, Server Actions, caching, and advanced full-stack React patterns.
allowed-tools: Read, Write, Edit, Glob, Grep
---

# Next.js Best Practices

> Comprehensive principles and patterns for Next.js 14+ App Router development.

---

## 1. Server vs Client Components

### Decision Tree

```
Does it need...?
│
├── useState, useEffect, event handlers
│   └── Client Component ('use client')
│
├── Direct data fetching, no interactivity
│   └── Server Component (default)
│
└── Both? 
    └── Split: Server parent + Client child
```

### By Default

| Type | Use |
|------|-----|
| **Server** | Data fetching, layout, static content |
| **Client** | Forms, buttons, interactive UI |

### Rendering Modes

| Mode | Where | When to Use |
|------|-------|-------------|
| **Server Components** | Server only | Data fetching, heavy computation, secrets |
| **Client Components** | Browser | Interactivity, hooks, browser APIs |
| **Static** | Build time | Content that rarely changes |
| **Dynamic** | Request time | Personalized or real-time data |
| **Streaming** | Progressive | Large pages, slow data sources |

---

## 2. Data Fetching Patterns

### Fetch Strategy

| Pattern | Use |
|---------|-----|
| **Default** | Static (cached at build) |
| **Revalidate** | ISR (time-based refresh) |
| **No-store** | Dynamic (every request) |

### Data Flow

| Source | Pattern |
|--------|---------|
| Database | Server Component fetch |
| API | fetch with caching |
| User input | Client state + server action |

### Streaming with Suspense

Use `<Suspense>` to progressively stream slow data sources without blocking the full page render. Each async Server Component wrapped in Suspense loads independently.

---

## 3. Routing Principles

### File Conventions

| File | Purpose |
|------|---------|
| `page.tsx` | Route UI |
| `layout.tsx` | Shared layout |
| `loading.tsx` | Loading state (Suspense) |
| `error.tsx` | Error boundary |
| `not-found.tsx` | 404 page |
| `route.ts` | API endpoint |
| `template.tsx` | Re-mounted layout |
| `default.tsx` | Parallel route fallback |
| `opengraph-image.tsx` | OG image generation |

### Route Organization

| Pattern | Use |
|---------|-----|
| Route groups `(name)` | Organize without URL impact |
| Parallel routes `@slot` | Multiple same-level pages with independent loading |
| Intercepting `(.)` | Modal overlays (e.g. photo modal) |
| Catch-all `[...slug]` | Dynamic segments |

---

## 4. API Routes (Route Handlers)

### Methods

| Method | Use |
|--------|-----|
| GET | Read data |
| POST | Create data |
| PUT/PATCH | Update data |
| DELETE | Remove data |

### Best Practices

- Validate input with Zod
- Return proper status codes
- Handle errors gracefully
- Use Edge runtime when possible

---

## 5. Server Actions

### Use Cases

- Form submissions
- Data mutations
- Revalidation triggers (revalidateTag, revalidatePath)

### Best Practices

- Mark with `'use server'`
- Validate all inputs
- Return typed responses
- Handle errors with try/catch
- Use `useTransition` on client for pending states
- Use `redirect()` for post-mutation navigation

---

## 6. Performance Principles

### Image Optimization

- Use `next/image` component
- Set `priority` for above-fold images
- Provide blur placeholder
- Use responsive `sizes`

### Bundle Optimization

- Dynamic imports for heavy components
- Route-based code splitting (automatic)
- Analyze with bundle analyzer

### Core Web Vitals

- Minimize LCP with streaming and priority images
- Reduce CLS with explicit dimensions
- Optimize FID with Server Components (less client JS)

---

## 7. Metadata & SEO

### Static vs Dynamic

| Type | Use |
|------|-----|
| Static `metadata` export | Fixed metadata |
| `generateMetadata` function | Dynamic per-route metadata |
| `generateStaticParams` | Pre-render dynamic routes at build |

### Essential Tags

- title (50-60 chars)
- description (150-160 chars)
- Open Graph images
- Canonical URL
- Twitter card metadata

---

## 8. Caching Strategy

### Cache Layers

| Layer | Control |
|-------|---------|
| Request | fetch options |
| Data | revalidate/tags |
| Full route | route config |

### Revalidation

| Method | Use |
|--------|-----|
| Time-based | `next: { revalidate: 60 }` |
| Tag-based | `next: { tags: ['products'] }` + `revalidateTag()` |
| Path-based | `revalidatePath('/products')` |
| No cache | `cache: 'no-store'` |

---

## 9. Anti-Patterns

| Don't | Do |
|----------|-------|
| `'use client'` everywhere | Server by default |
| Fetch in client components | Fetch in server |
| Skip loading states | Use `loading.tsx` / `<Suspense>` |
| Ignore error boundaries | Use `error.tsx` |
| Large client bundles | Dynamic imports |
| Pass non-serializable data across boundary | Keep complex objects server-side |
| Use hooks in Server Components | Only in Client Components |
| Over-nest layouts | Flatten when possible |

---

## 10. Project Structure

```
app/
├── (marketing)/     # Route group
│   └── page.tsx
├── (dashboard)/
│   ├── layout.tsx   # Dashboard layout
│   ├── @analytics/  # Parallel route
│   │   ├── page.tsx
│   │   └── loading.tsx
│   ├── @team/       # Parallel route
│   │   └── page.tsx
│   └── page.tsx
├── api/
│   └── [resource]/
│       └── route.ts
├── actions/         # Server Actions
│   └── cart.ts
└── components/
    └── ui/
```

---

## 11. Migration: Pages Router to App Router

- Move pages incrementally (both routers can coexist)
- Convert `getServerSideProps` to async Server Components
- Convert `getStaticProps` to fetch with `revalidate`
- Replace `useRouter` (pages) with `useRouter` (next/navigation)
- Replace `_app.tsx` and `_document.tsx` with `layout.tsx`

---

## Resources

- `resources/implementation-playbook.md` for detailed patterns, code samples, and advanced examples (parallel routes, intercepting routes, streaming, route handlers, metadata, caching).

---

> **Remember:** Server Components are the default for a reason. Start there, add client only when needed.
