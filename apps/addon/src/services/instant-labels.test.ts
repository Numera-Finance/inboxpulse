import { describe, it, expect } from 'vitest';
import {
  InstantLabelState, INSTANT_LABELS, INSTANT_TTL_MS,
  instantLabelByKey, isInstantLabelName,
} from './instant-labels';

describe('instant labels', () => {
  it('turns on and reports minutes left', () => {
    let t = 0;
    const s = new InstantLabelState(() => t);
    s.turnOn('t1', 'focus');
    expect(s.isOn('t1', 'focus')).toBe(true);
    expect(s.minutesLeft('t1', 'focus')).toBe(30);
    t = 10 * 60_000;
    expect(s.minutesLeft('t1', 'focus')).toBe(20);
  });

  it('turns itself off after thirty minutes', () => {
    // The failure mode of every manual labelling system is accretion. Expiry
    // inverts the default so nothing persists long enough to accumulate.
    let t = 0;
    const s = new InstantLabelState(() => t);
    s.turnOn('t1', 'focus');
    t = INSTANT_TTL_MS - 1;
    expect(s.isOn('t1', 'focus')).toBe(true);
    t = INSTANT_TTL_MS;
    expect(s.isOn('t1', 'focus')).toBe(false);
  });

  it('turns off on demand, before expiry', () => {
    const s = new InstantLabelState(() => 0);
    s.turnOn('t1', 'focus');
    expect(s.turnOff('t1', 'focus')).toBe(true);
    expect(s.isOn('t1', 'focus')).toBe(false);
    expect(s.turnOff('t1', 'focus')).toBe(false);
  });

  it('extends rather than duplicating when turned on again', () => {
    let t = 0;
    const s = new InstantLabelState(() => t);
    s.turnOn('t1', 'focus');
    t = 20 * 60_000;
    s.turnOn('t1', 'focus');
    expect(s.minutesLeft('t1', 'focus')).toBe(30);
    expect(s.active()).toHaveLength(1);
  });

  it('keeps labels independent per thread and per label', () => {
    const s = new InstantLabelState(() => 0);
    s.turnOn('t1', 'focus');
    s.turnOn('t1', 'research');
    s.turnOn('t2', 'focus');
    expect(s.active()).toHaveLength(3);
    s.turnOff('t1', 'focus');
    expect(s.isOn('t1', 'research')).toBe(true);
    expect(s.isOn('t2', 'focus')).toBe(true);
  });

  it('hands back exactly what expired, once', () => {
    let t = 0;
    const s = new InstantLabelState(() => t);
    s.turnOn('t1', 'focus');
    s.turnOn('t2', 'research');
    t = INSTANT_TTL_MS + 1;
    expect(s.takeExpired().map((a) => a.threadId).sort()).toEqual(['t1', 't2']);
    expect(s.takeExpired()).toHaveLength(0);
  });

  it('never collides with the analysis labels a sweep might delete', () => {
    // The analysis set (apps/api/src/labels/policy.ts) uses `InboxPulse/`;
    // these use `InboxPulse ⚡/`. remove-gmail-labels.ts deletes by prefix, so a
    // sweep of one must never take the other with it.
    const analysisNames = ['InboxPulse/Churn risk', 'InboxPulse/Upsell', 'InboxPulse/Negative'];
    for (const l of INSTANT_LABELS) {
      expect(isInstantLabelName(l.name)).toBe(true);
      expect(analysisNames).not.toContain(l.name);
    }
    for (const n of analysisNames) {
      expect(isInstantLabelName(n)).toBe(false);
    }
  });

  it('describes the user intent, not the message', () => {
    // A label the user chose cannot be a false positive — which is the whole
    // reason these escape the precision budget the analysis labels live under.
    for (const l of INSTANT_LABELS) {
      expect(l.means.length).toBeGreaterThan(8);
    }
    expect(INSTANT_LABELS.map((l) => l.key)).toEqual(['focus', 'research', 'blocktime', 'waiting']);
  });

  it('stays a short list — four states, not a taxonomy', () => {
    expect(INSTANT_LABELS.length).toBeLessThanOrEqual(4);
  });

  it('resolves by key and refuses unknown keys', () => {
    expect(instantLabelByKey('focus')?.name).toContain('Focus');
    expect(instantLabelByKey('nonsense')).toBeNull();
  });
});
