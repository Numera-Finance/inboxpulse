import { describe, expect, it } from 'vitest';
import { explain, findIdioms, IDIOMS } from './idioms';

/**
 * The distinction these tests protect is not accuracy, it is what gets SHOWN.
 *
 * A wrong score costs one bad flag. A wrong explanation teaches a bookkeeper to
 * read the next email wrongly, and the product exists to raise that person's
 * floor. On 250 held-out emails the patterns that name something literally
 * written were right 15/15; the ones that infer what the writer meant were wrong
 * 4 times in 10. Only the former may be rendered.
 */

describe('explain', () => {
  it('shows an annotation that names what is on the page', () => {
    const hits = explain('Not good to have so many iterations on this.');
    expect(hits.map((h) => h.id)).toContain('litotes');
    expect(hits[0].means).toMatch(/understatement/i);
  });

  it('shows the counterfactual, which was mined rather than invented', () => {
    // "should have been" carries 9x lift over base rate in the training half.
    const hits = explain('The reconciliation should have been done in March.');
    expect(hits.map((h) => h.id)).toContain('counterfactual');
  });

  it('stays silent on patterns that infer what the writer meant', () => {
    // "escalate_to_call" was right 0 times out of 1 held out, and "consequence"
    // 2 of 3. Both still score as features; neither is ever shown.
    const text = 'This is holding up our KYC — can we get on a call today?';
    expect(findIdioms(text).length).toBeGreaterThan(0);
    expect(explain(text)).toHaveLength(0);
  });

  it('says nothing rather than guessing on ordinary mail', () => {
    expect(explain('Attaching the March bank statements as requested. Thanks!')).toHaveLength(0);
  });

  it('every shown annotation carries a plain-language meaning', () => {
    // The text is read by someone learning the register, so an annotation with
    // no explanation is worse than no annotation.
    for (const idiom of IDIOMS.filter((i) => i.teaches)) {
      expect(idiom.means.length).toBeGreaterThan(20);
      expect(idiom.means).toMatch(/[.!]$/);
      expect(idiom.readsAs.length).toBeGreaterThan(5);
    }
  });

  it('quotes the phrase that fired, so the lesson is anchored to the text', () => {
    const hits = explain('As I mentioned last week, the VAT line is still wrong.');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].quote.toLowerCase()).toContain('as i mentioned');
  });
});

describe('the teaches flag', () => {
  it('is set explicitly on every idiom', () => {
    // A new pattern defaulting to shown would silently widen what the product
    // asserts to a reader.
    for (const idiom of IDIOMS) {
      expect(typeof idiom.teaches).toBe('boolean');
    }
  });

  it('keeps the inferential patterns available as features', () => {
    // They are not deleted — they still carry weight for scoring, they are only
    // never rendered.
    const inferential = IDIOMS.filter((i) => !i.teaches);
    expect(inferential.length).toBeGreaterThan(0);
    for (const idiom of inferential) expect(idiom.weight).toBeGreaterThan(0);
  });
});
