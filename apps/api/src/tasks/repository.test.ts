import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { and, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Permission, type RequestHeader } from '@crm/shared';
import { TaskRepository } from './repository';

/**
 * These tests pin the task/escalation visibility rule: the usual scoping is
 * reporting hierarchy AND customer access, but a direct assignee always sees
 * what is assigned to them. That extra arm is what makes an escalation handed
 * to someone off the customer's team reachable when they log in.
 */

const USER_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_TENANT_ID = '44444444-4444-4444-4444-444444444444';
const CUSTOMER_ID = '55555555-5555-5555-5555-555555555555';

/** Reaches the private filter builder without instantiating a database. */
function taskFilters(header: RequestHeader): SQL[] {
  const repository = new TaskRepository({} as never) as unknown as {
    buildTaskFilters(header: RequestHeader, options: Record<string, never>): SQL[];
  };
  return repository.buildTaskFilters(header, {});
}

function render(header: RequestHeader): string {
  return new PgDialect().sqlToQuery(and(...taskFilters(header))!).sql;
}

function nonAdminHeader(): RequestHeader {
  return { tenantId: TENANT_ID, userId: USER_ID, permissions: [] };
}

describe('TaskRepository.buildTaskFilters access scoping', () => {
  it('keeps hierarchy and customer access as a conjunction for non-admins', () => {
    const sql = render(nonAdminHeader());

    expect(sql).toContain('user_subordinates');
    expect(sql).toContain('user_accessible_customers');
  });

  it('admits a direct assignee who fails the customer-access arm', () => {
    // The OR arm must sit outside the (hierarchy AND customer) group, so an
    // assignee off the customer's team still matches.
    expect(render(nonAdminHeader())).toMatch(
      /\)\s*OR\s+"tasks"\."assigned_to_id"\s*=\s*\$\d/
    );
  });

  it('always isolates by tenant', () => {
    expect(render(nonAdminHeader())).toContain('"tasks"."tenant_id"');
  });

  it('leaves admins unrestricted beyond tenant isolation', () => {
    const sql = render({
      tenantId: TENANT_ID,
      userId: USER_ID,
      permissions: [Permission.ADMIN],
    });

    expect(sql).toContain('"tasks"."tenant_id"');
    expect(sql).not.toContain('user_subordinates');
    expect(sql).not.toContain('user_accessible_customers');
  });
});

/**
 * The write gate. It must admit exactly what the two list surfaces show —
 * the escalations page (customer OR assigned) and the task list ((hierarchy
 * AND customer) OR assigned) — so no user can act on something they cannot
 * see, and nothing they can see 404s on them.
 */
function stubRepository(
  task: { tenantId: string; assignedToId: string | null; customerId: string } | null,
  hasCustomerAccess: boolean
): TaskRepository {
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(task ? [task] : []) }) }),
    execute: () => Promise.resolve(hasCustomerAccess ? [{ ok: 1 }] : []),
  };
  return new TaskRepository(db as never);
}

function canAct(
  task: { tenantId: string; assignedToId: string | null; customerId: string } | null,
  hasCustomerAccess: boolean,
  permissions: number[] = []
): Promise<boolean> {
  const repository = stubRepository(task, hasCustomerAccess) as unknown as {
    hasTaskAccess(header: RequestHeader, taskId: string): Promise<boolean>;
  };
  return repository.hasTaskAccess(
    { tenantId: TENANT_ID, userId: USER_ID, permissions },
    '66666666-6666-6666-6666-666666666666'
  );
}

const mine = { tenantId: TENANT_ID, assignedToId: USER_ID, customerId: CUSTOMER_ID };
const someoneElses = { tenantId: TENANT_ID, assignedToId: OTHER_USER_ID, customerId: CUSTOMER_ID };
const unassigned = { tenantId: TENANT_ID, assignedToId: null, customerId: CUSTOMER_ID };

describe('TaskRepository.hasTaskAccess', () => {
  it('admits the assignee even with no access to the customer', async () => {
    await expect(canAct(mine, false)).resolves.toBe(true);
  });

  it('admits a user with customer access to a task assigned to someone else', async () => {
    // Otherwise assigning an escalation outside your hierarchy would lose you
    // control of it: still listed on the escalations page, but every write 404s.
    await expect(canAct(someoneElses, true)).resolves.toBe(true);
  });

  it('refuses a task that is neither yours nor on a customer you can access', async () => {
    await expect(canAct(someoneElses, false)).resolves.toBe(false);
  });

  it('refuses an unassigned task on an inaccessible customer', async () => {
    await expect(canAct(unassigned, false)).resolves.toBe(false);
  });

  it('admits an unassigned task on an accessible customer', async () => {
    await expect(canAct(unassigned, true)).resolves.toBe(true);
  });

  it('refuses a task in another tenant, even for an admin', async () => {
    const foreign = { ...someoneElses, tenantId: OTHER_TENANT_ID };
    await expect(canAct(foreign, true, [Permission.ADMIN])).resolves.toBe(false);
  });

  it('refuses a task that does not exist', async () => {
    await expect(canAct(null, true, [Permission.ADMIN])).resolves.toBe(false);
  });

  it('admits an admin within the tenant regardless of customer access', async () => {
    await expect(canAct(someoneElses, false, [Permission.ADMIN])).resolves.toBe(true);
  });
});
