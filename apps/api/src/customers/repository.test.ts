import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { SQL, Column, is, getTableName } from 'drizzle-orm';
import { CustomerRepository } from './repository';

function collectColumnRefs(node: unknown): string[] {
  const out: string[] = [];
  const visit = (c: unknown): void => {
    if (!c || typeof c !== 'object') return;
    if (is(c as never, Column)) {
      const col = c as { name: string; table: unknown };
      out.push(`${getTableName(col.table as never)}.${col.name}`);
    }
    const chunks = (c as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) chunks.forEach(visit);
  };
  visit(node);
  return out;
}

function collectRawStrings(node: unknown): string {
  const parts: string[] = [];
  const visit = (c: unknown): void => {
    if (typeof c === 'string') {
      parts.push(c);
      return;
    }
    if (!c || typeof c !== 'object') return;
    const stringChunkValue = (c as { value?: unknown }).value;
    if (Array.isArray(stringChunkValue)) {
      for (const s of stringChunkValue) if (typeof s === 'string') parts.push(s);
    }
    const chunks = (c as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) chunks.forEach(visit);
  };
  visit(node);
  return parts.join(' ');
}

function makeRepository(): CustomerRepository {
  return new CustomerRepository({} as never);
}

describe('CustomerRepository.buildFreeformSearch', () => {
  it('returns undefined for empty and whitespace-only terms', () => {
    const repo = makeRepository();
    expect(repo.buildFreeformSearch('')).toBeUndefined();
    expect(repo.buildFreeformSearch('   ')).toBeUndefined();
  });

  it('returns SQL referencing customer name, domains, and labels', () => {
    const repo = makeRepository();
    const result = repo.buildFreeformSearch('priority');
    expect(result).toBeInstanceOf(SQL);

    const refs = collectColumnRefs(result);
    expect(refs).toContain('customers.name');
    expect(refs).toContain('customer_domains.domain');
    expect(refs).toContain('customers.labels');

    // The labels branch relies on jsonb_array_elements_text; verify it's in the raw SQL
    const raw = collectRawStrings(result);
    expect(raw).toMatch(/jsonb_array_elements_text/);
  });
});
