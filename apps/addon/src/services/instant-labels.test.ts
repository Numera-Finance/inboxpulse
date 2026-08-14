import { describe, it, expect } from 'vitest';
import {
  InstantLabelState, INSTANT_LABELS, INSTANT_TTL_MS,
  instantLabelByKey, isInstantLabelName,
  MODE_LABELS,
  modeLabelFor,
  retiredLabelNames,
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
    // The analysis set is `InboxPulse/…`; ours is `⚡/…`. Neither prefix may
    // match the other, or a teardown of one removes the other.
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

describe('mode labels', () => {
  it('never labels fyi — the largest mode', () => {
    // Labelling most of an inbox to say nothing is needed is `Automated` at
    // 51.7% all over again.
    expect(modeLabelFor('fyi')).toBeNull();
  });

  it('covers every mode that does need something', () => {
    for (const m of ['complaint', 'scheduling', 'working', 'opportunity']) {
      expect(modeLabelFor(m), m).not.toBeNull();
    }
  });

  it('names the action, not the classification', () => {
    // "Unhappy" tells the reader why the row is worth opening; "complaint" is
    // our pipeline's opinion of it, which the user does not care about.
    expect(modeLabelFor('complaint')!.name).toContain('Unhappy');
    expect(modeLabelFor('working')!.name).toContain('Reply due');
    for (const l of MODE_LABELS) expect(l.name).not.toMatch(/complaint|opportunity/i);
  });

  it('shares the sweepable namespace so Clear all removes them too', () => {
    for (const l of MODE_LABELS) expect(isInstantLabelName(l.name)).toBe(true);
  });

  it('does not collide with the user-chosen labels', () => {
    const user = new Set(INSTANT_LABELS.map((l) => l.name));
    for (const l of MODE_LABELS) expect(user.has(l.name)).toBe(false);
  });

  it('keeps the chip readable — the prefix is one character', () => {
    // Gmail truncated the row chip to "InboxPul.../Waiting on you": twelve
    // characters of branding pushing out the only part that carries meaning,
    // on every row. The chip IS the product surface here.
    for (const l of [...INSTANT_LABELS, ...MODE_LABELS]) {
      expect(l.name.split('/')[0].length, l.name).toBeLessThanOrEqual(2);
    }
  });

  it('still recognises the old prefix, so teardown can reach old labels', () => {
    // Dropping it would strand labels we wrote — applied by us, unsweepable by
    // us, which is the orphaning this feature keeps answering for.
    expect(isInstantLabelName('InboxPulse ⚡/Focus')).toBe(true);
    expect(isInstantLabelName('⚡/Focus')).toBe(true);
    expect(isInstantLabelName('InboxPulse/Churn risk')).toBe(false);
  });
});

describe('retired labels', () => {
  it('lists every legacy-prefixed name for deletion', () => {
    // Renaming the prefix created a SECOND set beside the first: sixteen
    // labels where eight were intended, half permanently empty.
    const retired = retiredLabelNames();
    for (const l of [...INSTANT_LABELS, ...MODE_LABELS]) {
      expect(retired).toContain(l.name.replace('⚡/', 'InboxPulse ⚡/'));
    }
  });

  it('retires every name this set has ever carried', () => {
    // Each rename leaves a definition behind in the sidebar unless retired
    // explicitly — that is how eight labels became sixteen.
    for (const gone of [
      '⚡/Waiting on', '⚡/Blocked', '⚡/Block time', '⚡/Waiting on you',
      '⚡/Needs a time', '⚡/Needs reply',
    ]) {
      expect(retiredLabelNames(), gone).toContain(gone);
    }
  });

  it('no two labels share a word', () => {
    // 'Waiting on' collided with 'Waiting on you'; renaming it to 'Blocked'
    // then collided with 'Block time'. Renaming one at a time without looking
    // at the whole set just moves the collision.
    const words = [...INSTANT_LABELS, ...MODE_LABELS].map((l) =>
      l.name.split('/')[1].toLowerCase().split(/\s+/),
    );
    for (let i = 0; i < words.length; i += 1) {
      for (let j = i + 1; j < words.length; j += 1) {
        const shared = words[i].filter((w) => words[j].includes(w) && w.length > 2);
        expect(shared, `${words[i].join(' ')} vs ${words[j].join(' ')}`).toHaveLength(0);
      }
    }
  });

  it('never retires a name that is still in use', () => {
    const live = new Set([...INSTANT_LABELS, ...MODE_LABELS].map((l) => l.name));
    for (const r of retiredLabelNames()) expect(live.has(r)).toBe(false);
  });
});
