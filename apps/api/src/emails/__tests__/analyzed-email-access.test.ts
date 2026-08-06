import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Permission, type RequestHeader } from '@crm/shared';
import { EmailRepository } from '../repository';

/**
 * These tests pin the access rule for the AI Analysis (escalations) queries:
 * a user reaches an analyzed email through their accessible customers OR
 * because the escalation is assigned to them directly. The second arm is what
 * lets an escalation be handed to someone outside the customer's team and
 * still be visible to them when they log in.
 */

const USER_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = '22222222-2222-2222-2222-222222222222';

/** Reaches the private predicate under test without instantiating a database. */
function accessFilter(header: RequestHeader): SQL | null {
  const repository = new EmailRepository({} as never) as unknown as {
    analyzedEmailAccessFilter(header: RequestHeader): SQL | null;
  };
  return repository.analyzedEmailAccessFilter(header);
}

function render(header: RequestHeader): { sql: string; params: unknown[] } {
  const filter = accessFilter(header);
  if (!filter) throw new Error('expected a filter');
  const query = new PgDialect().sqlToQuery(filter);
  return { sql: query.sql, params: query.params };
}

function nonAdminHeader(): RequestHeader {
  return { tenantId: TENANT_ID, userId: USER_ID, permissions: [] };
}

describe('EmailRepository.analyzedEmailAccessFilter', () => {
  it('returns no filter for admins, who see every analyzed email in the tenant', () => {
    const header: RequestHeader = {
      tenantId: TENANT_ID,
      userId: USER_ID,
      permissions: [Permission.ADMIN],
    };

    expect(accessFilter(header)).toBeNull();
  });

  it('lets a non-admin through on accessible customers', () => {
    expect(render(nonAdminHeader()).sql).toContain('ep.customer_id IN');
    expect(render(nonAdminHeader()).sql).toContain('user_accessible_customers');
  });

  it('also lets a non-admin through on direct assignment, regardless of customer team', () => {
    expect(render(nonAdminHeader()).sql).toMatch(/OR\s+t\.assigned_to_id\s*=\s*\$\d/);
  });

  it('scopes both arms to the caller, as bound values rather than inlined text', () => {
    const { sql, params } = render(nonAdminHeader());

    expect(params.filter(v => v === USER_ID)).toHaveLength(2);
    expect(sql).not.toContain(USER_ID);
  });
});
