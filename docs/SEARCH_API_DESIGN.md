# Search API Design

## Overview

Search APIs allow clients to query resources with flexible filtering, sorting, and pagination. All search operations follow a consistent pattern across all resources.

## Design Principles

1. **Operator-based queries** - Simple, composable filters
2. **Type-safe** - Zod schemas for validation
3. **Consistent** - Same pattern for all resources
4. **Performant** - Maps directly to SQL queries
5. **Secure** - Automatic tenant isolation

## Search Request Structure

```typescript
{
  queries: [
    {
      field: "status",           // Field name (maps to DB column)
      operator: "eq",            // Operator
      value: "active"            // Value (type depends on field)
    },
    {
      field: "createdAt",
      operator: "gte",
      value: "2024-01-01"
    },
    {
      field: "name",
      operator: "like",
      value: "%acme%"
    }
  ],
  sortBy: "createdAt",           // Optional: field to sort by
  sortOrder: "desc",             // Optional: "asc" | "desc" (default: "asc")
  limit: 20,                     // Optional: max results (default: 20, max: 100)
  offset: 0                      // Optional: pagination offset (default: 0)
}
```

## Supported Operators

| Operator | Description | Value Type | SQL Equivalent | Example |
|----------|-------------|------------|----------------|---------|
| `eq` | Equals | any | `WHERE field = value` | `{ field: "status", operator: "eq", value: "active" }` |
| `ne` | Not equals | any | `WHERE field != value` | `{ field: "status", operator: "ne", value: "deleted" }` |
| `gt` | Greater than | number/date | `WHERE field > value` | `{ field: "price", operator: "gt", value: 100 }` |
| `gte` | Greater than or equal | number/date | `WHERE field >= value` | `{ field: "createdAt", operator: "gte", value: "2024-01-01" }` |
| `lt` | Less than | number/date | `WHERE field < value` | `{ field: "age", operator: "lt", value: 65 }` |
| `lte` | Less than or equal | number/date | `WHERE field <= value` | `{ field: "score", operator: "lte", value: 100 }` |
| `like` | Pattern match | string | `WHERE field LIKE value` | `{ field: "name", operator: "like", value: "%acme%" }` |
| `in` | In array | array | `WHERE field IN (...)` | `{ field: "status", operator: "in", value: ["active", "pending"] }` |
| `notIn` | Not in array | array | `WHERE field NOT IN (...)` | `{ field: "id", operator: "notIn", value: ["1", "2"] }` |

## Search Response Structure

```typescript
{
  success: true,
  data: {
    items: [/* array of resources */],
    total: 150,        // Total matching records (for pagination)
    limit: 20,
    offset: 0
  }
}
```

## Implementation Architecture

```
Route Handler
    ↓
    Validates searchRequestSchema
    ↓
Service Layer
    ↓
    Builds field mapping
    ↓
    Converts queries → SQL conditions
    ↓
    Adds tenant isolation
    ↓
Repository Layer
    ↓
    Executes SQL query
    ↓
    Returns results + total count
    ↓
Service Layer
    ↓
    Converts DB objects → Response objects
    ↓
Route Handler
    ↓
    Returns SearchResponse
```

## Example: Company Search API

### 1. Route Handler

```typescript
// apps/api/src/customers/routes.ts
import { searchRequestSchema } from '@crm/shared';
import { handleApiRequest } from '../utils/api-handler';

app.post('/customers/search', async (c) => {
  return handleApiRequest(
    c,
    searchRequestSchema,
    async (requestHeader, searchRequest) => {
      const service = container.resolve(CompanyService);
      return await service.search(requestHeader, searchRequest);
    }
  );
});
```

### 2. Service Layer

```typescript
// apps/api/src/customers/service.ts
import { buildSearchConditions } from '../utils/search-utils';
import { eq, and } from 'drizzle-orm';
import { customers } from './schema';
import type { SearchRequest, SearchResponse } from '@crm/shared';

async search(
  requestHeader: RequestHeader,
  searchRequest: SearchRequest
): Promise<SearchResponse<CompanyResponse>> {
  // 1. Define field mapping (API field names → DB columns)
  const fieldMapping = {
    name: customers.name,
    status: customers.status,
    industry: customers.industry,
    createdAt: customers.createdAt,
    updatedAt: customers.updatedAt,
  };
  
  // 2. Build search conditions from queries
  const searchConditions = buildSearchConditions(
    searchRequest.queries,
    fieldMapping
  );
  
  // 3. Add tenant isolation (CRITICAL for security)
  const tenantCondition = eq(customers.tenantId, requestHeader.tenantId);
  
  // 4. Combine all conditions
  const whereCondition = searchConditions
    ? and(searchConditions, tenantCondition)
    : tenantCondition;
  
  // 5. Execute search via repository
  const results = await this.repository.search({
    where: whereCondition,
    sortBy: searchRequest.sortBy ? fieldMapping[searchRequest.sortBy] : undefined,
    sortOrder: searchRequest.sortOrder || 'asc',
    limit: searchRequest.limit || 20,
    offset: searchRequest.offset || 0,
  });
  
  // 6. Convert DB objects to response objects
  const items = results.items.map(item => this.toResponse(item));
  
  return {
    items,
    total: results.total,
    limit: searchRequest.limit || 20,
    offset: searchRequest.offset || 0,
  };
}
```

### 3. Repository Layer

```typescript
// apps/api/src/customers/repository.ts
import { SQL, count, desc, asc } from 'drizzle-orm';

interface SearchOptions {
  where?: SQL;
  sortBy?: PgColumn;
  sortOrder: 'asc' | 'desc';
  limit: number;
  offset: number;
}

async search(options: SearchOptions): Promise<{
  items: Company[];
  total: number;
}> {
  const { where, sortBy, sortOrder, limit, offset } = options;
  
  // Build query
  let query = this.db.select().from(customers);
  
  // Add WHERE clause
  if (where) {
    query = query.where(where);
  }
  
  // Add sorting
  if (sortBy) {
    query = sortOrder === 'desc'
      ? query.orderBy(desc(sortBy))
      : query.orderBy(asc(sortBy));
  } else {
    // Default sort by createdAt desc
    query = query.orderBy(desc(customers.createdAt));
  }
  
  // Add pagination
  query = query.limit(limit).offset(offset);
  
  // Execute query
  const items = await query;
  
  // Get total count (for pagination)
  let countQuery = this.db.select({ count: count() }).from(customers);
  if (where) {
    countQuery = countQuery.where(where);
  }
  const [{ count: total }] = await countQuery;
  
  return { items, total };
}
```

## Field Mapping Pattern

Each resource defines its own field mapping:

```typescript
// Customers
const companyFieldMapping = {
  name: customers.name,
  status: customers.status,
  industry: customers.industry,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
};

// Contacts
const contactFieldMapping = {
  email: contacts.email,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  customerId: contacts.customerId,
  createdAt: contacts.createdAt,
};

// Emails
const emailFieldMapping = {
  subject: emails.subject,
  from: emails.from,
  to: emails.to,
  sentAt: emails.sentAt,
  analysisStatus: emails.analysisStatus,
};
```

## Advanced: Nested Field Search

For searching related resources (e.g., customers by contact email):

```typescript
// Option 1: Join in repository (recommended)
async searchWithJoins(options: SearchOptions) {
  return await this.db
    .select({
      company: customers,
      contact: contacts,
    })
    .from(customers)
    .leftJoin(contacts, eq(customers.id, contacts.customerId))
    .where(
      and(
        eq(customers.tenantId, tenantId),
        like(contacts.email, '%@acme.com')
      )
    );
}

// Option 2: Separate endpoint
// GET /customers?contactEmail=...
```

## Access Control Integration

### Overview

Search APIs MUST enforce two levels of access control:
1. **Tenant isolation** - Filter by `tenantId`
2. **Company access** - Filter by accessible customers via hierarchy

### Using ScopedSearchBuilder

The recommended approach is to use `ScopedSearchBuilder` which handles both:

```typescript
import { scopedSearch } from '@crm/database';

async search(
  header: RequestHeader,
  request: SearchRequest
): Promise<SearchResponse<ContactResponse>> {

  const context = {
    tenantId: header.tenantId,
    employeeId: header.employeeId,
  };

  // ScopedSearchBuilder handles:
  // 1. Tenant isolation (automatic in constructor)
  // 2. Company access filter (via withCompanyScope)
  // 3. User's search queries (via applyQueries)
  const where = scopedSearch(contacts, this.fieldMapping, context)
    .withCompanyScope()              // Adds company access filter
    .applyQueries(request.queries)   // Adds user's search filters
    .build();

  const results = await this.repository.search({
    where,
    sortBy: request.sortBy ? this.fieldMapping[request.sortBy] : undefined,
    sortOrder: request.sortOrder,
    limit: request.limit,
    offset: request.offset,
  });

  return {
    items: results.items.map(this.toResponse),
    total: results.total,
    limit: request.limit,
    offset: request.offset,
  };
}
```

### Generated SQL

The above code generates:

```sql
SELECT *
FROM contacts
WHERE
  -- Tenant isolation (from constructor)
  contacts.tenant_id = '123-tenant-uuid'

  -- Company access (from withCompanyScope)
  AND contacts.customer_id IN (
    SELECT ec.customer_id
    FROM employee_hierarchy eh
    JOIN employee_customers ec ON ec.employee_id = eh.descendant_id
    WHERE eh.ancestor_id = '456-employee-uuid'
  )

  -- User's search filters (from applyQueries)
  AND contacts.name ILIKE '%john%'
  AND contacts.status = 'active'

ORDER BY contacts.created_at DESC
LIMIT 20 OFFSET 0;
```

### RequestHeader Extension

`RequestHeader` must include `employeeId`:

```typescript
interface RequestHeader {
  tenantId: string;
  userId: string;
  employeeId: string;  // Required for company access control
}
```

### Full Access Control Documentation

See [ACCESS_CONTROL_DESIGN.md](./ACCESS_CONTROL_DESIGN.md) for:
- Base repository pattern
- All helper methods
- Update/delete access checks
- Testing patterns

---

## Validation & Security

### Field Validation

```typescript
// Validate that search fields are allowed
const ALLOWED_FIELDS = ['name', 'status', 'industry', 'createdAt'];

function validateSearchFields(queries: SearchQuery[]) {
  for (const query of queries) {
    if (!ALLOWED_FIELDS.includes(query.field)) {
      throw new ValidationError(`Field '${query.field}' is not searchable`);
    }
  }
}
```

### Tenant Isolation

**CRITICAL**: Always add tenant isolation. When using `ScopedSearchBuilder`, this is automatic:

```typescript
// Automatic with ScopedSearchBuilder
const where = scopedSearch(table, fieldMapping, context)
  .withCompanyScope()
  .build();

// Manual approach (legacy)
const tenantCondition = eq(customers.tenantId, requestHeader.tenantId);
const whereCondition = and(searchConditions, tenantCondition);
```

### SQL Injection Prevention

- Use Drizzle ORM (parameterized queries)
- Never use string concatenation for SQL
- Validate field names against allowed list
- Validate operator values

## Usage Examples

### Example 1: Simple Filter

```bash
POST /api/customers/search
{
  "queries": [
    { "field": "status", "operator": "eq", "value": "active" }
  ]
}
```

### Example 2: Multiple Filters (AND)

```bash
POST /api/customers/search
{
  "queries": [
    { "field": "status", "operator": "eq", "value": "active" },
    { "field": "createdAt", "operator": "gte", "value": "2024-01-01" },
    { "field": "name", "operator": "like", "value": "%tech%" }
  ],
  "sortBy": "createdAt",
  "sortOrder": "desc",
  "limit": 50
}
```

### Example 3: Pagination

```bash
POST /api/customers/search
{
  "queries": [
    { "field": "status", "operator": "eq", "value": "active" }
  ],
  "limit": 20,
  "offset": 40  // Page 3 (20 per page)
}
```

### Example 4: Array Filter

```bash
POST /api/customers/search
{
  "queries": [
    { "field": "status", "operator": "in", "value": ["active", "pending"] }
  ]
}
```

## Performance Considerations

1. **Indexes**: Ensure searchable fields are indexed
   ```sql
   CREATE INDEX idx_customers_status ON customers(status);
   CREATE INDEX idx_customers_created_at ON customers(created_at);
   ```

2. **Limit max queries**: Enforce max 20 queries per request

3. **Limit max results**: Enforce max 100 results per request

4. **Count queries**: Consider caching total counts for expensive queries

5. **Full-text search**: For text search, consider PostgreSQL full-text search:
   ```typescript
   // Advanced: Full-text search
   {
     field: "name",
     operator: "fts",  // Full-text search
     value: "acme corporation"
   }
   ```

## Future Enhancements

1. **OR conditions**: Support OR between queries
   ```typescript
   {
     queries: [...],
     operator: "OR"  // Default is AND
   }
   ```

2. **Nested queries**: Support grouping
   ```typescript
   {
     queries: [
       { field: "status", operator: "eq", value: "active" },
       {
         operator: "OR",
         queries: [
           { field: "name", operator: "like", value: "%acme%" },
           { field: "industry", operator: "eq", value: "tech" }
         ]
       }
     ]
   }
   ```

3. **Full-text search**: PostgreSQL tsvector for better text search

4. **Faceted search**: Return counts by category
   ```typescript
   {
     items: [...],
     facets: {
       status: { active: 50, inactive: 20 },
       industry: { tech: 30, finance: 40 }
     }
   }
   ```

---

## Related Documents

- [ACCESS_CONTROL_DESIGN.md](./ACCESS_CONTROL_DESIGN.md) - Scoped queries and access control
- Employee hierarchy and closure table: the `employees` entity was merged into
  `users`; see `apps/api/src/users/schema.ts` and `docs/handbook/04-DATA-MODEL.md`.
- [API_CONVENTIONS.md](./API_CONVENTIONS.md) - General API conventions
