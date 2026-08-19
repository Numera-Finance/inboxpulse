import { describe, it, expect } from 'vitest';
import { resolveWhen, calendarUrl, calendarStamp } from './when';

// A Wednesday, so weekday arithmetic has a real forward/backward case.
const WED = new Date(2026, 7, 12);

describe('resolveWhen', () => {
  it('reads an explicit ISO date', () => {
    expect(calendarStamp(resolveWhen('by 2026-09-03', WED)!)).toBe('20260903');
  });

  it('resolves a weekday forward, never backward', () => {
    // Monday is behind us this week; the commitment must mean the coming one.
    expect(calendarStamp(resolveWhen('Monday', WED)!)).toBe('20260817');
  });

  it('reads a weekday said on that same day as the next one', () => {
    expect(calendarStamp(resolveWhen('Wednesday', WED)!)).toBe('20260819');
  });

  it('adds a week for "next week" with a weekday', () => {
    expect(calendarStamp(resolveWhen('next week Friday', WED)!)).toBe('20260821');
  });

  it('handles today and tomorrow', () => {
    expect(calendarStamp(resolveWhen('by EOD today', WED)!)).toBe('20260812');
    expect(calendarStamp(resolveWhen('tomorrow morning', WED)!)).toBe('20260813');
  });

  it('reads month-and-day in either order', () => {
    expect(calendarStamp(resolveWhen('Nov 3', WED)!)).toBe('20261103');
    expect(calendarStamp(resolveWhen('3rd November', WED)!)).toBe('20261103');
  });

  it('rolls a month already past into next year', () => {
    expect(calendarStamp(resolveWhen('Feb 2', WED)!)).toBe('20270202');
  });

  it('returns null rather than guessing', () => {
    // A reminder on the wrong day is worse than none: it teaches the user to
    // ignore the ones that are right.
    expect(resolveWhen('soon', WED)).toBeNull();
    expect(resolveWhen('when the migration lands', WED)).toBeNull();
    expect(resolveWhen('', WED)).toBeNull();
    expect(resolveWhen(undefined, WED)).toBeNull();
  });
});

describe('calendarUrl', () => {
  it('builds an all-day template link with an exclusive end date', () => {
    const url = calendarUrl('Send the revised SOW', new Date(2026, 7, 14));
    expect(url).toContain('action=TEMPLATE');
    expect(url).toContain('dates=20260814%2F20260815');
    expect(url).toContain('text=Send+the+revised+SOW');
  });
});
