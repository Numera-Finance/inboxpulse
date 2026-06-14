import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { LoginHistoryService } from './login-history-service';
import type { LoginHistoryRow } from './login-history-repository';

function makeService(rows: LoginHistoryRow[] = []) {
  const captured: {
    tenantId?: string;
    startDate?: Date;
    endDate?: Date;
  } = {};

  const repo = {
    findByTenantInRange: vi.fn(async (tenantId: string, startDate: Date, endDate: Date) => {
      captured.tenantId = tenantId;
      captured.startDate = startDate;
      captured.endDate = endDate;
      return rows;
    }),
  };

  const service = new LoginHistoryService(repo as never);
  return { service, repo, captured };
}

const HEADER =
  'Logged In At (UTC),Email,First Name,Last Name,IP Address,User Agent';

describe('LoginHistoryService.exportLast30DaysCsv', () => {
  it('returns CSV with just the header when there are no events', async () => {
    const { service } = makeService([]);
    const csv = await service.exportLast30DaysCsv('tenant-1');
    expect(csv).toBe(`${HEADER}\r\n`);
  });

  it('queries the repository with a 30-day window for the requested tenant', async () => {
    const { service, captured } = makeService([]);
    await service.exportLast30DaysCsv('tenant-1');
    expect(captured.tenantId).toBe('tenant-1');
    expect(captured.startDate).toBeInstanceOf(Date);
    expect(captured.endDate).toBeInstanceOf(Date);
    const diffMs = captured.endDate!.getTime() - captured.startDate!.getTime();
    expect(diffMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('renders rows with ISO timestamps in row order from the repository', async () => {
    const { service } = makeService([
      {
        loggedInAt: new Date('2026-04-15T12:34:56.000Z'),
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Adams',
        ipAddress: '203.0.113.5',
        userAgent: 'Mozilla/5.0',
      },
    ]);
    const csv = await service.exportLast30DaysCsv('tenant-1');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe(
      '2026-04-15T12:34:56.000Z,alice@example.com,Alice,Adams,203.0.113.5,Mozilla/5.0'
    );
    expect(lines[2]).toBe('');
  });

  it('escapes commas, double quotes, newlines, and renders nulls as empty', async () => {
    const { service } = makeService([
      {
        loggedInAt: new Date('2026-04-15T00:00:00.000Z'),
        email: 'bob@example.com',
        firstName: 'Bob, Jr.',
        lastName: 'O"Reilly',
        ipAddress: null,
        userAgent: 'Line1\r\nLine2',
      },
    ]);
    const csv = await service.exportLast30DaysCsv('tenant-1');

    expect(csv).toContain('"Bob, Jr."');
    expect(csv).toContain('"O""Reilly"');
    expect(csv).toContain('"Line1\r\nLine2"');
    // null ip → adjacent commas with no quoting between last name and user agent
    expect(csv).toContain(',"O""Reilly",,"Line1');
  });
});
