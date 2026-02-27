import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { parseKeywords } from './service';

describe('parseKeywords', () => {
  it('parses single words separated by spaces', () => {
    expect(parseKeywords('urgent critical')).toEqual(['urgent', 'critical']);
  });

  it('parses single words separated by newlines', () => {
    expect(parseKeywords('urgent\ncritical')).toEqual(['urgent', 'critical']);
  });

  it('parses mixed spaces and newlines', () => {
    expect(parseKeywords('urgent\ncritical important')).toEqual(['urgent', 'critical', 'important']);
  });

  it('parses double-quoted multi-word phrases', () => {
    expect(parseKeywords('"well done"')).toEqual(['well done']);
  });

  it('parses mix of quoted phrases and single words', () => {
    expect(parseKeywords('"well done" great')).toEqual(['well done', 'great']);
  });

  it('parses multiple quoted phrases', () => {
    expect(parseKeywords('"cancel subscription" "very upset"')).toEqual(['cancel subscription', 'very upset']);
  });

  it('parses quoted phrases with surrounding single words', () => {
    expect(parseKeywords('urgent "cancel subscription" churn')).toEqual(['urgent', 'cancel subscription', 'churn']);
  });

  it('handles extra whitespace', () => {
    expect(parseKeywords('  urgent   critical  ')).toEqual(['urgent', 'critical']);
  });

  it('handles empty string', () => {
    expect(parseKeywords('')).toEqual([]);
  });

  it('handles whitespace-only string', () => {
    expect(parseKeywords('   \n  \n  ')).toEqual([]);
  });

  it('treats empty quotes as literal token', () => {
    expect(parseKeywords('""')).toEqual(['""']);
  });

  it('handles tabs', () => {
    expect(parseKeywords('urgent\tcritical')).toEqual(['urgent', 'critical']);
  });

  it('handles quoted phrase on its own line', () => {
    expect(parseKeywords('urgent\n"well done"\ncritical')).toEqual(['urgent', 'well done', 'critical']);
  });

  // Curly/smart quote support
  it('parses curly-quoted multi-word phrases', () => {
    expect(parseKeywords('\u201cwell done\u201d')).toEqual(['well done']);
  });

  it('parses curly-quoted phrases with single words', () => {
    expect(parseKeywords('\u201ccancel subscription\u201d churn')).toEqual(['cancel subscription', 'churn']);
  });

  it('parses mix of straight and curly quotes', () => {
    expect(parseKeywords('"urgent issue"\n\u201cLack of response\u201d\n"Poor service"')).toEqual([
      'urgent issue',
      'Lack of response',
      'Poor service',
    ]);
  });

  it('does not split curly-quoted phrases into separate words', () => {
    const input = '\u201cLoss of confidence\u201d\n\u201cError in reporting\u201d';
    const parsed = parseKeywords(input);
    expect(parsed).toEqual(['Loss of confidence', 'Error in reporting']);
    expect(parsed).not.toContain('of');
    expect(parsed).not.toContain('in');
  });

  it('handles real-world negative keywords from DB', () => {
    const input = '"???"\n\u201cConcerned\u201d\n"Concerning"\n\u201cNot satisfied\u201d\n\u201cDisappointed\u201d\n"Disappointing"\n\u201cFrustrated\u201d';
    const parsed = parseKeywords(input);
    expect(parsed).toEqual([
      '???',
      'Concerned',
      'Concerning',
      'Not satisfied',
      'Disappointed',
      'Disappointing',
      'Frustrated',
    ]);
    expect(parsed).not.toContain('of');
    expect(parsed).not.toContain('in');
  });

  it('handles curly double low-9 quotation mark (U+201E)', () => {
    expect(parseKeywords('\u201ewell done\u201d')).toEqual(['well done']);
  });
});
