# Access Control Design

## Overview

This document defines the access control model for the CRM platform, including how employees gain access to customers through the organizational hierarchy and how this is enforced in API queries using scoped queries.

## Access Control Model

### Hierarchical Access

An employee has access to:
1. **Their own customers** - Customers directly assigned to them
2. **Descendant customers** - Customers assigned to anyone who reports to them (direct or indirect)

This allows managers to see all data related to their team's customers.

### Data Flow

```
Employee logs in
    ↓
Query employee_hierarchy (closure table)
    ↓
Find all descendants (including self)
    ↓
Query employee_customers for all descendants
    ↓
Result: Set of accessible company IDs
    ↓
All subsequent queries filter by these customers
```

---

## Approach: Scoped Queries (Not RLS)

We chose **scoped queries** over PostgreSQL Row-Level Security (RLS) for the following reasons:

| Aspect | RLS | Scoped Queries |
|--------|-----|----------------|
| **Enforcement** | Automatic (database) | Manual (application) |
| **Visibility** | Hidden filtering | Explicit in code |
| **Debugging** | Difficult | Easy to trace |
| **Testing** | Complex setup | Simple unit tests |
| **Performance** | Variable (planner-dependent) | Predictable |
| **Connection pooling** | Session variable issues | No issues |
| **Flexibility** | Rigid per-table | Per-query control |

### When RLS Might Be Better

- Very large teams where developers frequently forget filters
- Compliance requirements mandating database-level enforcement
- Simple access patterns (single tenant, no hierarchy)

---

## Implementation

### 1. Base Repository Class

All repositories that need access control extend this base class:

```typescript
// packages/database/src/base-repository.ts
import { SQL, sql, eq, and } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

export interface AccessContext {
  tenantId: string;
  employeeId: string;
}

export abstract class ScopedRepository {
  constructor(protected db: Database) {}

  /**
   * Returns SQL condition for company access control.
   * Use this in WHERE clauses to filter by accessible customers.
   */
  protected companyAccessFilter(
    customerIdColumn: PgColumn,
    context: AccessContext
  ): SQL {
    return sql`${customerIdColumn} IN (
      SELECT ec.customer_id
      FROM employee_hierarchy eh
      JOIN employee_customers ec ON ec.employee_id = eh.descendant_id
      WHERE eh.ancestor_id = ${context.employeeId}
    )`;
  }

  /**
   * Returns SQL condition for tenant isolation.
   * MUST be included in every query.
   */
  protected tenantFilter(
    tenantIdColumn: PgColumn,
    context: AccessContext
  ): SQL {
    return eq(tenantIdColumn, context.tenantId);
  }

  /**
   * Combines tenant + company access filters.
   * Standard filter for most queries.
   */
  protected accessFilter(
    tenantIdColumn: PgColumn,
    customerIdColumn: PgColumn,
    context: AccessContext
  ): SQL {
    return and(
      this.tenantFilter(tenantIdColumn, context),
      this.companyAccessFilter(customerIdColumn, context)
    )!;
  }

  /**
   * Check if context has access to a specific company.
   */
  protected async hasCompanyAccess(
    context: AccessContext,
    customerId: string
  ): Promise<boolean> {
    const [result] = await this.db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM employee_hierarchy eh
        JOIN employee_customers ec ON ec.employee_id = eh.descendant_id
        WHERE eh.ancestor_id = ${context.employeeId}
          AND ec.customer_id = ${customerId}
      ) as exists
    `);
    return result?.exists ?? false;
  }
}
```

### 2. Scoped Search Builder

For complex queries with multiple optional filters:

```typescript
// packages/database/src/scoped-search-builder.ts
import {
  SQL, and, or, eq, ne, gt, gte, lt, lte,
  like, ilike, inArray, notInArray, isNull, isNotNull, sql
} from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { ValidationError } from '@crm/shared';

export interface FieldMapping {
  [key: string]: PgColumn;
}

export interface SearchContext {
  employeeId: string;
  tenantId: string;
}

export interface SearchQuery {
  field: string;
  operator: string;
  value: unknown;
}

export class ScopedSearchBuilder<T extends PgTable> {
  private conditions: (SQL | undefined)[] = [];

  constructor(
    private table: T,
    private fieldMapping: FieldMapping,
    private context: SearchContext
  ) {
    // Tenant isolation is ALWAYS added first
    const tenantColumn = this.fieldMapping['tenantId'];
    if (tenantColumn) {
      this.conditions.push(eq(tenantColumn, context.tenantId));
    }
  }

  /**
   * Add company access scope.
   * Call this for tables that have a customerId column.
   */
  withCompanyScope(customerIdColumn?: PgColumn): this {
    const column = customerIdColumn || this.fieldMapping['customerId'];
    if (column) {
      this.conditions.push(
        sql`${column} IN (
          SELECT ec.customer_id
          FROM employee_hierarchy eh
          JOIN employee_customers ec ON ec.employee_id = eh.descendant_id
          WHERE eh.ancestor_id = ${this.context.employeeId}
        )`
      );
    }
    return this;
  }

  /**
   * Apply search queries from API request.
   */
  applyQueries(queries: SearchQuery[]): this {
    for (const query of queries) {
      const column = this.fieldMapping[query.field];
      if (!column) {
        throw new ValidationError(`Field '${query.field}' is not searchable`);
      }
      const condition = this.buildCondition(column, query.operator, query.value);
      if (condition) {
        this.conditions.push(condition);
      }
    }
    return this;
  }

  /**
   * Add a custom condition.
   */
  where(condition: SQL | undefined): this {
    if (condition) {
      this.conditions.push(condition);
    }
    return this;
  }

  /**
   * Add a condition only if value is present.
   * Inspired by Drizzle's pattern of passing undefined to skip conditions.
   */
  whereIf<V>(
    value: V | undefined | null,
    buildCondition: (v: V) => SQL | undefined
  ): this {
    if (value !== undefined && value !== null && value !== '') {
      const condition = buildCondition(value);
      if (condition) {
        this.conditions.push(condition);
      }
    }
    return this;
  }

  /**
   * Add equals condition if value is present.
   */
  whereEq(column: PgColumn, value: unknown | undefined): this {
    return this.whereIf(value, (v) => eq(column, v));
  }

  /**
   * Add ILIKE condition if value is present (case-insensitive).
   */
  whereLike(column: PgColumn, value: string | undefined): this {
    return this.whereIf(value, (v) => ilike(column, `%${v}%`));
  }

  /**
   * Add IN condition if array has values.
   */
  whereIn(column: PgColumn, values: unknown[] | undefined): this {
    if (values && values.length > 0) {
      this.conditions.push(inArray(column, values));
    }
    return this;
  }

  /**
   * Add date range condition.
   */
  whereDateRange(
    column: PgColumn,
    from: Date | string | undefined,
    to: Date | string | undefined
  ): this {
    if (from) {
      this.conditions.push(gte(column, from));
    }
    if (to) {
      this.conditions.push(lte(column, to));
    }
    return this;
  }

  /**
   * Build the final WHERE clause.
   * Returns undefined if no conditions (though tenant filter should always be present).
   */
  build(): SQL | undefined {
    const validConditions = this.conditions.filter(Boolean) as SQL[];
    if (validConditions.length === 0) {
      return undefined;
    }
    if (validConditions.length === 1) {
      return validConditions[0];
    }
    return and(...validConditions);
  }

  /**
   * Build condition for a single search query.
   */
  private buildCondition(
    column: PgColumn,
    operator: string,
    value: unknown
  ): SQL | undefined {
    switch (operator) {
      case 'eq':
        return eq(column, value);
      case 'ne':
        return ne(column, value);
      case 'gt':
        return gt(column, value as number | Date);
      case 'gte':
        return gte(column, value as number | Date);
      case 'lt':
        return lt(column, value as number | Date);
      case 'lte':
        return lte(column, value as number | Date);
      case 'like':
        return like(column, value as string);
      case 'ilike':
        return ilike(column, value as string);
      case 'in':
        return Array.isArray(value) && value.length > 0
          ? inArray(column, value)
          : undefined;
      case 'notIn':
        return Array.isArray(value) && value.length > 0
          ? notInArray(column, value)
          : undefined;
      case 'isNull':
        return isNull(column);
      case 'isNotNull':
        return isNotNull(column);
      default:
        throw new ValidationError(`Unknown operator: ${operator}`);
    }
  }
}

/**
 * Factory function for cleaner usage.
 */
export function scopedSearch<T extends PgTable>(
  table: T,
  fieldMapping: FieldMapping,
  context: SearchContext
): ScopedSearchBuilder<T> {
  return new ScopedSearchBuilder(table, fieldMapping, context);
}
```

---

## Usage Patterns

### Pattern 1: Simple Query with Access Control

```typescript
// apps/api/src/contacts/repository.ts

@injectable()
export class ContactRepository extends ScopedRepository {

  async findAll(context: AccessContext): Promise<Contact[]> {
    return this.db
      .select()
      .from(contacts)
      .where(this.accessFilter(
        contacts.tenantId,
        contacts.customerId,
        context
      ));
  }

  async findById(context: AccessContext, id: string): Promise<Contact | null> {
    const [contact] = await this.db
      .select()
      .from(contacts)
      .where(and(
        eq(contacts.id, id),
        this.accessFilter(contacts.tenantId, contacts.customerId, context)
      ));
    return contact ?? null;
  }
}
```

### Pattern 2: Search with Multiple Filters

```typescript
// apps/api/src/contacts/service.ts

async search(
  header: RequestHeader,
  request: SearchRequest
): Promise<SearchResponse<ContactResponse>> {

  const context = { tenantId: header.tenantId, employeeId: header.employeeId };

  const where = scopedSearch(contacts, {
    tenantId: contacts.tenantId,
    customerId: contacts.customerId,
    email: contacts.email,
    name: contacts.name,
    title: contacts.title,
    createdAt: contacts.createdAt,
  }, context)
    .withCompanyScope()
    .applyQueries(request.queries)
    .build();

  const results = await this.repository.search({
    where,
    sortBy: request.sortBy,
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

### Pattern 3: Complex Filters with Conditionals

```typescript
async searchWithFilters(
  header: RequestHeader,
  filters: {
    search?: string;
    industry?: string;
    status?: string[];
    createdAfter?: Date;
    createdBefore?: Date;
  }
): Promise<Contact[]> {

  const context = { tenantId: header.tenantId, employeeId: header.employeeId };

  const where = scopedSearch(contacts, this.fieldMapping, context)
    .withCompanyScope()
    // Text search across multiple fields
    .whereIf(filters.search, (v) =>
      or(
        ilike(contacts.name, `%${v}%`),
        ilike(contacts.email, `%${v}%`),
        ilike(contacts.title, `%${v}%`)
      )
    )
    // Single value filter
    .whereEq(contacts.status, filters.status)
    // Array filter
    .whereIn(contacts.status, filters.status)
    // Date range
    .whereDateRange(contacts.createdAt, filters.createdAfter, filters.createdBefore)
    .build();

  return this.db.select().from(contacts).where(where);
}
```

### Pattern 4: Update with Access Check

```typescript
async update(
  context: AccessContext,
  id: string,
  data: Partial<Contact>
): Promise<Contact> {

  // Update only if user has access
  const [updated] = await this.db
    .update(contacts)
    .set({ ...data, updatedAt: new Date() })
    .where(and(
      eq(contacts.id, id),
      this.accessFilter(contacts.tenantId, contacts.customerId, context)
    ))
    .returning();

  if (!updated) {
    // Check if record exists to give proper error
    const exists = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);

    if (exists.length === 0) {
      throw new NotFoundError('Contact not found');
    } else {
      throw new ForbiddenError('Access denied to this contact');
    }
  }

  return updated;
}
```

### Pattern 5: Aggregations with Scope

```typescript
async getCompanyStats(context: AccessContext): Promise<CompanyStats[]> {
  return this.db
    .select({
      customerId: contacts.customerId,
      contactCount: sql<number>`count(*)`,
      latestContact: sql<Date>`max(${contacts.createdAt})`,
    })
    .from(contacts)
    .where(this.accessFilter(contacts.tenantId, contacts.customerId, context))
    .groupBy(contacts.customerId);
}
```

---

## Generated SQL Examples

### Query with Scope

```typescript
const where = scopedSearch(contacts, fieldMapping, context)
  .withCompanyScope()
  .whereEq(contacts.status, 'active')
  .whereLike(contacts.name, 'john')
  .build();
```

**Generated SQL:**

```sql
SELECT *
FROM contacts
WHERE
  -- Tenant isolation
  contacts.tenant_id = '123-tenant-uuid'

  -- Company access control
  AND contacts.customer_id IN (
    SELECT ec.customer_id
    FROM employee_hierarchy eh
    JOIN employee_customers ec ON ec.employee_id = eh.descendant_id
    WHERE eh.ancestor_id = '456-employee-uuid'
  )

  -- Business filters
  AND contacts.status = 'active'
  AND contacts.name ILIKE '%john%'
```

---

## RequestHeader Extension

The `RequestHeader` type must include `employeeId`:

```typescript
// packages/shared/src/api/types.ts

export interface RequestHeader {
  tenantId: string;
  userId: string;
  employeeId: string;  // Required for scoped queries
}
```

The `requestHeaderMiddleware` must populate `employeeId` from the JWT token or by looking up the employee by `userId`.

---

## Testing Scoped Queries

### Unit Test Pattern

```typescript
describe('ContactRepository', () => {
  it('should filter contacts by company access', async () => {
    // Setup: Create employees, customers, contacts
    const ceo = await createEmployee({ email: 'ceo@test.com' });
    const manager = await createEmployee({ email: 'manager@test.com' });
    const ic = await createEmployee({ email: 'ic@test.com' });

    // CEO manages Manager, Manager manages IC
    await assignManager(manager.id, ceo.id);
    await assignManager(ic.id, manager.id);
    await rebuildHierarchy(tenantId);

    // Customers assigned to different levels
    const companyA = await createCompany({ name: 'Company A' });
    const companyB = await createCompany({ name: 'Company B' });
    await assignCompany(ceo.id, companyA.id);
    await assignCompany(ic.id, companyB.id);

    // Contacts in each company
    const contactA = await createContact({ customerId: companyA.id });
    const contactB = await createContact({ customerId: companyB.id });

    // Test: CEO sees both (via hierarchy)
    const ceoContacts = await repo.findAll({ tenantId, employeeId: ceo.id });
    expect(ceoContacts).toHaveLength(2);

    // Test: IC sees only their own company
    const icContacts = await repo.findAll({ tenantId, employeeId: ic.id });
    expect(icContacts).toHaveLength(1);
    expect(icContacts[0].id).toBe(contactB.id);
  });
});
```

---

## Checklist for New Tables

When adding a new table that needs access control:

- [ ] Table has `tenant_id` column (for tenant isolation)
- [ ] Table has `customer_id` column (for company access control)
- [ ] Repository extends `ScopedRepository`
- [ ] All queries use `accessFilter()` or `scopedSearch().withCompanyScope()`
- [ ] Updates/deletes include access filter in WHERE clause
- [ ] Tests verify access control behavior

---

## Performance Considerations

### Index Requirements

Ensure these indexes exist for efficient scoped queries:

```sql
-- On employee_hierarchy (closure table)
CREATE INDEX idx_hierarchy_ancestor ON employee_hierarchy(ancestor_id);
CREATE INDEX idx_hierarchy_descendant ON employee_hierarchy(descendant_id);

-- On employee_customers (junction table)
CREATE INDEX idx_employee_customers_employee ON employee_customers(employee_id);
CREATE INDEX idx_employee_customers_company ON employee_customers(customer_id);

-- On each table with customer_id
CREATE INDEX idx_contacts_company ON contacts(customer_id);
CREATE INDEX idx_deals_company ON deals(customer_id);
```

### Query Performance

The company access subquery is efficient because:
1. It uses indexed joins on the closure table
2. PostgreSQL can cache the subquery result
3. For a CEO with 3000 customers, the subquery returns ~3000 UUIDs which is fine for `IN` clause

If performance becomes an issue:
1. Cache accessible company IDs in Redis on login
2. Use a temporary table per request for very large result sets
3. Consider materialized views for complex access patterns

---

## Related Documents

- [EMPLOYEE_SCHEMA_DESIGN.md](./EMPLOYEE_SCHEMA_DESIGN.md) - Employee tables and closure table
- [SEARCH_API_DESIGN.md](./SEARCH_API_DESIGN.md) - Search API patterns
- [API_CONVENTIONS.md](./API_CONVENTIONS.md) - API conventions including scoped queries
