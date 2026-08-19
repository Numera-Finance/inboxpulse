import { describe, it, expect } from 'vitest';
import { safeErrorDetail } from './api-error';

/**
 * An API error body must never reach a log line verbatim.
 *
 * Every model and Gmail call used to log `await res.text()` truncated to a
 * couple of hundred characters, defended as "the API's output, not the user's
 * mail". A reviewer of the permissions page rejected that: the storage promise
 * was scoped to our cache and said nothing about logs, and an error body is the
 * one place message-adjacent text could surface. A content-filter rejection can
 * quote the input that tripped it.
 */
describe('safeErrorDetail', () => {
  it('keeps the diagnostic fields', () => {
    const body = JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'x' } });
    expect(safeErrorDetail(body)).toBe('error.code=429 error.status=RESOURCE_EXHAUSTED');
  });

  /** `message` is the field that can echo the prompt. It must not survive. */
  it('drops the message field even when it quotes the input', () => {
    const body = JSON.stringify({
      error: { code: 400, status: 'INVALID_ARGUMENT', message: 'blocked: "Re: Q3 payroll for Acme"' },
    });
    const out = safeErrorDetail(body);
    expect(out).not.toContain('payroll');
    expect(out).not.toContain('Acme');
    expect(out).toContain('400');
  });

  it('reports an HTML error page by length, without reproducing it', () => {
    const out = safeErrorDetail('<html><body>Gateway Timeout — upstream said hello</body></html>');
    expect(out).toMatch(/unparseable body, \d+ chars/);
    expect(out).not.toContain('Gateway');
  });

  it('distinguishes an empty body from a parseable one', () => {
    expect(safeErrorDetail('')).toBe('empty body');
    expect(safeErrorDetail('   ')).toBe('empty body');
    expect(safeErrorDetail('{"ok":true}')).toBe('json body, no error object');
  });
});
