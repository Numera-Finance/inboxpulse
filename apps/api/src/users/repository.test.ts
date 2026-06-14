import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { SQL, Column, is, getTableName } from 'drizzle-orm';
import { UserRepository } from './repository';

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

function makeRepository(): UserRepository {
  return new UserRepository({} as never);
}

describe('UserRepository.buildFreeformSearch', () => {
  it('returns undefined for empty and whitespace-only terms', () => {
    const repo = makeRepository();
    expect(repo.buildFreeformSearch('')).toBeUndefined();
    expect(repo.buildFreeformSearch('   ')).toBeUndefined();
  });

  it('returns SQL referencing firstName, lastName, email, and roles.name', () => {
    const repo = makeRepository();
    const result = repo.buildFreeformSearch('alice');
    expect(result).toBeInstanceOf(SQL);

    const refs = collectColumnRefs(result);
    expect(refs).toContain('users.first_name');
    expect(refs).toContain('users.last_name');
    expect(refs).toContain('users.email');
    expect(refs).toContain('roles.name');
  });
});
