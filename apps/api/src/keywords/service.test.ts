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
});
