# Claude Code Rules for CRM Project

## Project Information

- **GCP Project**: `health-474623`
- **Services**:
  - `crm-web` - Next.js web application
  - `crm-api` - Hono API service (port 4001)
  - `crm-gmail` - Gmail sync service
  - `crm-notifications` - Notifications service (port 4004)

## API Client Architecture

### 1. Always Use Clients (Never Direct Fetch)
- Always use client classes from `@crm/clients` for API calls in the web app
- Create a new client class when adding a new API domain (e.g., `HolidayClient`)
- Never use direct `fetch()` calls in web app components

**Client Base Classes:**
- `AuthBaseClient` - For main API calls (port 4001) with cookie/session-based auth
- `InternalBaseClient` - For internal services requiring explicit `ServiceContext` (tenantId, userId)

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

## Quick Reference

| Rule | Location | Example |
|------|----------|---------|
| Client classes | `packages/clients/src/{module}/client.ts` | `HolidayClient` |
| Shared types | `packages/clients/src/{module}/types.ts` | `CreateHolidayRequest`, `Holiday` |
| SQL migrations | `apps/api/sql/{name}.sql` | `holidays.sql` |
| Client factory | `apps/web/lib/api/clients.ts` | `getHolidayClient()` |
