# Claude Code Rules for CRM Project

## Project Overview

Multi-tenant CRM platform built as a TypeScript monorepo. Handles customer management, email sync (Gmail), AI-powered email analysis, task management, dashboards, and notifications.

- **GCP Project**: `health-474623`
- **Runtime**: Bun (backend services), Vite (frontend dev), Nginx (frontend prod)
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **Auth**: Better-Auth with Google OAuth SSO

## Services

| Service | Package | Port | Description |
|---------|---------|------|-------------|
| `crm-web` | `apps/web` | 4000 | React 19 + Vite SPA |
| `crm-api` | `apps/api` | 4001 | Hono REST API (main backend) |
| `crm-gmail` | `apps/gmail` | 4002 | Gmail sync via Pub/Sub webhooks |
| `crm-analysis` | `apps/analysis` | 4003 | AI/LLM email analysis (OpenAI, Anthropic, Google, xAI) |
| `crm-notifications` | `apps/notifications` | 4004 | Email notifications via React Email + Inngest |

## Monorepo Structure

```
crm/
├── apps/
│   ├── web/             # React 19 + Vite + TailwindCSS 4 + shadcn/ui
│   ├── api/             # Hono REST API with tsyringe DI
│   ├── gmail/           # Gmail sync with googleapis + Pub/Sub
│   ├── analysis/        # Multi-provider AI analysis (AI SDK)
│   └── notifications/   # Notifications with React Email + Inngest
├── packages/
│   ├── clients/         # Type-safe HTTP clients (AuthBaseClient, InternalBaseClient)
│   ├── shared/          # Shared types, RBAC, errors, utilities
│   ├── database/        # Drizzle ORM setup, connection management
│   ├── ui/              # Radix UI + shadcn component library
│   ├── encryption/      # AES-256 encryption utilities
│   ├── notifications/   # Notification type definitions
│   └── cloud/google/    # GCP Secret Manager wrapper
├── turbo.json           # Turbo build orchestration
├── pnpm-workspace.yaml  # pnpm workspaces (apps/*, packages/*, packages/cloud/*)
└── tsconfig.json        # Base TS config with path aliases
```

## Development Commands

```bash
pnpm dev                              # Start all dev servers (Turbo)
pnpm build                            # Build entire monorepo
pnpm test                             # Run all tests (Vitest)
pnpm lint                             # Type-check all packages (tsc --noEmit)
pnpm clean                            # Remove dist/, node_modules/, .turbo/

pnpm --filter @crm/web dev            # Run single app
pnpm --filter @crm/api test           # Test single package
pnpm --filter @crm/database db:push   # Push Drizzle schema to DB
pnpm --filter @crm/database db:generate  # Generate Drizzle migrations
pnpm --filter @crm/database db:studio # Open Drizzle Studio GUI

pnpm db:push                          # Shortcut for schema push
pnpm oauth:setup                      # Configure OAuth credentials
```

## Tech Stack

### Frontend (`apps/web`)
- **React 19** with React Router 7, TanStack Query 5
- **Tailwind CSS 4** with shadcn/ui (Radix primitives)
- **React Hook Form** + Zod for form validation
- **TanStack Table** with React Virtual for data tables
- **Recharts** for charts, **Lucide React** for icons, **Sonner** for toasts
- **better-auth/client** for OAuth

### Backend (`apps/api`, `apps/gmail`, `apps/analysis`, `apps/notifications`)
- **Hono 4.6** web framework on Bun runtime
- **Drizzle ORM 0.36** with postgres.js driver
- **tsyringe** for dependency injection
- **Inngest** for background jobs and cron scheduling
- **Pino** for structured logging
- **AI SDK** (OpenAI, Anthropic, Google, xAI) + **Langfuse** for observability
- **googleapis** for Gmail API integration

### Shared
- **TypeScript 5.9** (strict mode, bundler module resolution)
- **Zod 4** for schema validation at all API boundaries
- **pnpm 9.14** + **Turbo 2.3** for monorepo management
- **tsup** for library bundling (dual CJS/ESM)
- **Vitest 2.1** for testing

## Path Aliases

Defined in root `tsconfig.json`:

| Alias | Path |
|-------|------|
| `@crm/api/*` | `apps/api/src/*` |
| `@crm/database/*` | `packages/database/src/*` |
| `@crm/shared/*` | `packages/shared/src/*` |
| `@crm/clients/*` | `packages/clients/src/*` |
| `@crm/gmail/*` | `apps/gmail/src/*` |
| `@crm/notifications` | `packages/notifications/src/index.ts` |

## Architecture Patterns

### API Module Structure

Each domain in `apps/api/src/` follows this pattern:

```
apps/api/src/{module}/
├── routes.ts       # Hono route handlers
├── service.ts      # Business logic (@injectable)
├── repository.ts   # Data access with Drizzle (@injectable)
└── schema.ts       # Drizzle table definitions
```

### Middleware Chain (API)

All protected routes go through this middleware stack in order:

1. **CORS** — Allows `localhost:4000` + configured `WEB_URL`
2. **Logger** — Hono built-in request logging
3. **betterAuthRequestHeaderMiddleware** — Validates session, resolves tenant, loads user permissions
4. **requirePermission()** — Route-level permission checks

### Dependency Injection (tsyringe)

```typescript
// apps/api/src/di/container.ts
container.register<Database>('Database', { useValue: db });
container.register(UserRepository, { useClass: UserRepository });
container.register(UserService, { useClass: UserService });

// In routes:
const service = container.resolve(HolidayService);
```

### API Response Format

All API responses use:

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; statusCode: number; };
}
```

### Request Handler Utilities

Use helpers from `apps/api/src/utils/api-handler.ts`:

```typescript
// POST with Zod validation
handleApiRequest(c, requestSchema, async (requestHeader, request) => { ... });

// POST with custom status code (e.g., 201)
handleApiRequestWithStatus(c, schema, 201, async (requestHeader, request) => { ... });

// GET (no body)
handleGetRequest(c, async (requestHeader) => { ... });

// GET with path params
handleGetRequestWithParams(c, paramsSchema, async (requestHeader, params) => { ... });
```

### Multi-Tenancy

- All database queries scoped by `tenantId` from `RequestHeader`
- Tenant resolved from better-auth session via middleware
- UUIDs (v7) for all primary keys

### RBAC (Role-Based Access Control)

Permissions defined in `packages/shared/src/types/rbac.ts`:

```typescript
// Route-level enforcement
holidayRoutes.use('*', requirePermission(Permission.ADMIN));

// Component-level in web app
<PermissionGate permission={Permission.USER_ADD}>...</PermissionGate>

// Helper functions
hasPermission(permissions, Permission.USER_ADD)
isAdmin(permissions)
```

### Service-to-Service Communication

Internal services (Gmail, Analysis, Notifications) use `InternalBaseClient` with headers:
- `x-internal-api-key` — Shared secret for auth
- `x-tenant-id` — Tenant context
- `x-user-id` — User context

## API Client Architecture

### 1. Always Use Clients (Never Direct Fetch)
- Always use client classes from `@crm/clients` for API calls in the web app
- Create a new client class when adding a new API domain (e.g., `HolidayClient`)
- Never use direct `fetch()` calls in web app components

**Client Base Classes:**
- `AuthBaseClient` — For main API calls (port 4001) with cookie/session-based auth
- `InternalBaseClient` — For internal services requiring explicit `ServiceContext` (tenantId, userId)

**Client Factory Pattern:**
```typescript
// apps/web/lib/api/clients.ts
let holidayClient: HolidayClient | null = null;

export function getHolidayClient(): HolidayClient {
  if (!holidayClient) {
    holidayClient = new HolidayClient(API_BASE_URL);
  }
  return holidayClient;
}
```

### 2. Always Create SQL Migration Files
- Always create a SQL migration file in `apps/api/sql/` for any schema changes
- Name files descriptively: `holidays.sql`, `user_preferences.sql`
- Include `CREATE TABLE`, indexes, and constraints in the same file
- Document execution order and dependencies in `apps/api/sql/README.md`
- For incremental changes to existing databases, add scripts to `apps/api/sql/migrations/`

### 3. Use Zod Schemas for Types
- Define ALL external-facing types as Zod schemas
- Use `z.infer<typeof schema>` to derive TypeScript types
- Validate at API boundaries using the exported Zod schemas

### 4. Store Shared Types in packages/clients
- Store ALL types shared between client and server in `packages/clients/src/{module}/types.ts`
- Define types as Zod schemas and export both schema and inferred type
- Structure: `packages/clients/src/{module}/types.ts`, `client.ts`, `index.ts`

### 5. Use Request/Response Pattern for Client Types
```typescript
// packages/clients/src/holiday/types.ts

// Request types - for data sent TO the API
export const createHolidayRequestSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  name: z.string(),
});
export type CreateHolidayRequest = z.infer<typeof createHolidayRequestSchema>;

// Response types - for data returned FROM the API
export const holidaySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  date: z.string(),
  timezone: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Holiday = z.infer<typeof holidaySchema>;
```

## Database

### Schema Definitions

Drizzle schemas live in `apps/api/src/{module}/schema.ts`. Key tables:

- **Auth**: `betterAuthUser`, `betterAuthSession`, `betterAuthAccount`, `betterAuthVerification`
- **Core**: `users`, `tenants`, `roles`
- **Customers**: `customers`, `contacts`, `customerDomains`
- **Email**: `emails`, `emailThreads`, `emailParticipants`, `emailAnalyses`, `threadAnalyses`
- **Tasks**: `tasks`, `taskComments`, `userSubordinates`
- **Other**: `dashboards`, `holidayCalendars`, `runs`, `integrations`

### Migration Workflow

1. Update Drizzle schema in `apps/api/src/{module}/schema.ts`
2. Create SQL migration file in `apps/api/sql/` (or `apps/api/sql/migrations/` for incremental)
3. Run `pnpm db:push` to apply schema to database
4. Update `apps/api/sql/README.md` with execution order

### SQL Migration Execution Order

See `apps/api/sql/README.md` for the full execution order. Apply with:

```bash
psql $DATABASE_URL -f apps/api/sql/{filename}.sql
```

## Testing

- **Framework**: Vitest 2.1 (globals: true, environment: node)
- **Location**: Test files alongside source as `*.test.ts` / `*.test.tsx`
- **Config**: Each package has its own `vitest.config.ts`
- **Run**: `pnpm test` (all) or `pnpm --filter @crm/{package} test`

## Deployment

### CI/CD (GitHub Actions)

`.github/workflows/deploy.yml` triggers on push to `main` (changes in `apps/` or `packages/`):

1. **detect-changes** — Determines which services changed (deploys all if `packages/` changed)
2. **deploy-{service}** — Builds Docker image → pushes to Artifact Registry → deploys to Cloud Run

### Cloud Run Configuration

| Service | Memory | CPU | Min/Max Instances |
|---------|--------|-----|-------------------|
| crm-web | 256Mi | 1 | 0/10 |
| crm-api | 512Mi | 1 | 0/10 |
| crm-gmail | 512Mi | 1 | 0/10 |
| crm-analysis | 512Mi | 1 | 0/10 |
| crm-notifications | 512Mi | 1 | 0/10 |

### Docker Builds

- **Backend services**: Node 22-alpine build stage → Bun alpine runtime
- **Frontend**: Node 22-alpine build stage → Nginx alpine runtime (port 8080)

## Environment Variables

### API (`apps/api/.env.local`)
```
PORT=4001
DATABASE_URL=postgresql://...
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
SERVICE_GMAIL_URL=http://localhost:4002
SERVICE_ANALYSIS_URL=http://localhost:4003
BETTER_AUTH_SECRET=<32+ chars>
BETTER_AUTH_URL=http://localhost:4001
WEB_URL=http://localhost:4000
```

### Web (`apps/web/.env.local`)
```
VITE_API_URL=http://localhost:4001
```

### Gmail / Analysis / Notifications
```
SERVICE_API_URL=http://localhost:4001
DATABASE_URL=postgresql://...
INTERNAL_API_KEY=<shared secret>
```

`.env.local` takes precedence over `.env`. Turbo watches `.env.*local` as global dependencies.

## Quick Reference

| What | Where | Example |
|------|-------|---------|
| Client classes | `packages/clients/src/{module}/client.ts` | `HolidayClient` |
| Shared types (Zod) | `packages/clients/src/{module}/types.ts` | `CreateHolidayRequest`, `Holiday` |
| API routes | `apps/api/src/{module}/routes.ts` | `holidayRoutes` |
| API services | `apps/api/src/{module}/service.ts` | `HolidayService` |
| Repositories | `apps/api/src/{module}/repository.ts` | `HolidayRepository` |
| DB schemas | `apps/api/src/{module}/schema.ts` | `holidayCalendars` |
| SQL migrations | `apps/api/sql/{name}.sql` | `holidays.sql` |
| Client factory | `apps/web/lib/api/clients.ts` | `getHolidayClient()` |
| DI container | `apps/api/src/di/container.ts` | `container.resolve(...)` |
| RBAC permissions | `packages/shared/src/types/rbac.ts` | `Permission.ADMIN` |
| UI components | `packages/ui/src/components/` | Radix + shadcn components |
| Background jobs | `apps/api/src/inngest/` | Inngest functions |
