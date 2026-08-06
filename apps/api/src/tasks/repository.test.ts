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
