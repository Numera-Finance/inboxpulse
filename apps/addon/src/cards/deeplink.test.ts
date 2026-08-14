import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The deep link is only useful if the tab next door opens ON the customer.
 * A link whose query string the target ignores looks identical to one that
 * works — nothing errors, the page just loads unfiltered — so the params are
 * asserted against the route that reads them.
 */
describe('web dashboard deep link', () => {
  const card = readFileSync(join(__dirname, 'thread.ts'), 'utf8');

  it('links to /escalations filtered by customer and status', () => {
    expect(card).toContain('/escalations?customer=');
    expect(card).toContain('status=open');
  });

  it('uses only params the escalations route actually reads', () => {
    // apps/web/app/escalations/page.tsx reads: customer, status, assigned,
    // signal, from, to.
    const allowed = new Set(['customer', 'status', 'assigned', 'signal', 'from', 'to']);
    const link = card.match(/\/escalations\?[^`]*/)?.[0] ?? '';
    for (const m of link.matchAll(/[?&]([a-zA-Z]+)=/g)) {
      expect(allowed, `unknown param: ${m[1]}`).toContain(m[1]);
    }
  });

  it('url-encodes the customer id rather than interpolating it raw', () => {
    expect(card).toContain('encodeURIComponent');
  });

  it('is not shown without a resolved customer', () => {
    // Linking to an unfiltered dashboard is worse than no link — it promises
    // context and delivers a landing page.
    expect(card).toContain('input.account?.customerId && input.webUrl');
  });
});
