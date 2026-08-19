import { describe, it, expect } from 'vitest';
import { deriveSearch } from './thread';

const VIEWER = 'grastogi@mystartupcfo.com';

describe('deriveSearch', () => {
  it('drops subject filler that narrows by nothing', () => {
    // "Another revenue reporting tool" produced (another OR revenue OR reporting
    // OR tool) on a live thread, which matches most of an inbox.
    const s = deriveSearch(
      { from: 'Manish <manish@mystartupcfo.com>', subject: 'Another revenue reporting tool' },
      VIEWER,
    );
    expect(s!.terms).not.toContain('another');
    expect(s!.terms).toContain('revenue');
  });

  it('does not scope a search to the viewer own domain', () => {
    // On an internal thread that is not a filter — it matches everything.
    const s = deriveSearch(
      { from: 'Manish <manish@mystartupcfo.com>', subject: 'Revenue reporting rollout' },
      VIEWER,
    );
    expect(s!.query).not.toContain('from:');
  });

  it('keeps an external sender domain, which narrows on its own', () => {
    const s = deriveSearch({ from: 'Sean <sean@callrevu.com>', subject: 'Quick update' }, VIEWER);
    expect(s!.query).toContain('from:(callrevu.com)');
  });

  it('returns nothing rather than a search that matches everything', () => {
    // Internal sender, one generic word left. A button that teaches the user it
    // is useless costs more than no button.
    expect(deriveSearch({ from: 'a@mystartupcfo.com', subject: 'Quick question' }, VIEWER)).toBeNull();
  });
});
