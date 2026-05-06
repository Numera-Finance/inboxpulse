import { describe, it, expect } from 'vitest';
import { safeRelativePath } from './safe-relative-path';

const ORIGIN = 'https://app.example.com';

describe('safeRelativePath', () => {
  it('returns "/" for empty / null / undefined', () => {
    expect(safeRelativePath(null, ORIGIN)).toBe('/');
    expect(safeRelativePath(undefined, ORIGIN)).toBe('/');
    expect(safeRelativePath('', ORIGIN)).toBe('/');
  });

  it('passes through same-origin relative paths', () => {
    expect(safeRelativePath('/escalations/abc-123', ORIGIN)).toBe('/escalations/abc-123');
    expect(safeRelativePath('/customers?signal=upsell&status=open', ORIGIN))
      .toBe('/customers?signal=upsell&status=open');
    expect(safeRelativePath('/tasks#section', ORIGIN)).toBe('/tasks#section');
  });

  it('rejects absolute cross-origin URLs', () => {
    expect(safeRelativePath('https://evil.com/path', ORIGIN)).toBe('/');
    expect(safeRelativePath('http://evil.com', ORIGIN)).toBe('/');
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeRelativePath('//evil.com', ORIGIN)).toBe('/');
    expect(safeRelativePath('//evil.com/path', ORIGIN)).toBe('/');
  });

  it('rejects backslash-bypassed protocol-relative URLs', () => {
    expect(safeRelativePath('/\\evil.com', ORIGIN)).toBe('/');
    expect(safeRelativePath('\\\\evil.com', ORIGIN)).toBe('/');
    expect(safeRelativePath('/path\\with\\backslashes', ORIGIN)).toBe('/');
  });

  it('rejects inputs that do not start with /', () => {
    expect(safeRelativePath('evil.com', ORIGIN)).toBe('/');
    expect(safeRelativePath('javascript:alert(1)', ORIGIN)).toBe('/');
    expect(safeRelativePath('data:text/html,...', ORIGIN)).toBe('/');
  });

  it('rejects same-host but cross-scheme URLs', () => {
    expect(safeRelativePath('http://app.example.com/path', 'https://app.example.com')).toBe('/');
  });
});
