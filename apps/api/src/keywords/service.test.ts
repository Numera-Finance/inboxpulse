import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { parseKeywords } from './service';

describe('parseKeywords', () => {
  it('splits on commas', () => {
    expect(parseKeywords('urgent, critical')).toEqual(['urgent', 'critical']);
  });

  it('splits on newlines', () => {
    expect(parseKeywords('urgent\ncritical')).toEqual(['urgent', 'critical']);
  });

  it('splits on tabs', () => {
    expect(parseKeywords('urgent\tcritical')).toEqual(['urgent', 'critical']);
  });

  it('preserves spaces inside an item so multi-word names stay intact', () => {
    expect(parseKeywords('cancel subscription, very upset')).toEqual([
      'cancel subscription',
      'very upset',
    ]);
  });

  it('handles a comma-separated competitor list with multi-word names', () => {
    const input = 'Inkle, Pilot, Burdick Tax & Accounting, Gettleson Witzer and O\'Connor';
    expect(parseKeywords(input)).toEqual([
      'Inkle',
      'Pilot',
      'Burdick Tax & Accounting',
      'Gettleson Witzer and O\'Connor',
    ]);
  });

  it('strips optional surrounding double quotes', () => {
    expect(parseKeywords('"well done"')).toEqual(['well done']);
  });

  it('strips optional surrounding curly quotes', () => {
    expect(parseKeywords('“well done”')).toEqual(['well done']);
  });

  it('handles curly double low-9 quotation mark (U+201E)', () => {
    expect(parseKeywords('„well done”')).toEqual(['well done']);
  });

  it('mixes quoted and unquoted comma-separated items', () => {
    expect(parseKeywords('"cancel subscription", churn, "very upset"')).toEqual([
      'cancel subscription',
      'churn',
      'very upset',
    ]);
  });

  it('trims whitespace around items', () => {
    expect(parseKeywords('  urgent  ,  critical  ')).toEqual(['urgent', 'critical']);
  });

  it('drops empty items between separators', () => {
    expect(parseKeywords('urgent,,critical\n\ncancel')).toEqual([
      'urgent',
      'critical',
      'cancel',
    ]);
  });

  it('handles empty string', () => {
    expect(parseKeywords('')).toEqual([]);
  });

  it('handles whitespace-only string', () => {
    expect(parseKeywords('   \n  \n  ')).toEqual([]);
  });

  it('drops items that are only empty quotes', () => {
    expect(parseKeywords('""')).toEqual([]);
  });

  it('handles real-world negative keywords from DB (curly-quoted, newline-separated)', () => {
    const input =
      '"???"\n“Concerned”\n"Concerning"\n“Not satisfied”\n“Disappointed”\n"Disappointing"\n“Frustrated”';
    expect(parseKeywords(input)).toEqual([
      '???',
      'Concerned',
      'Concerning',
      'Not satisfied',
      'Disappointed',
      'Disappointing',
      'Frustrated',
    ]);
  });

  it('does not split a multi-word phrase into separate words', () => {
    const input = '“Loss of confidence”\n“Error in reporting”';
    const parsed = parseKeywords(input);
    expect(parsed).toEqual(['Loss of confidence', 'Error in reporting']);
    expect(parsed).not.toContain('of');
    expect(parsed).not.toContain('in');
  });
});
