import { describe, it, expect } from 'vitest';
import { deriveParticipants, droppedOff } from './participants';

const VIEWER = 'grastogi@mystartupcfo.com';

describe('deriveParticipants', () => {
  it('aggregates across every message, not just the open one', () => {
    const p = deriveParticipants(
      [
        { from: 'Sean <sean@callrevu.com>', to: 'Dolly <dgupta@mystartupcfo.com>' },
        { from: 'Dolly <dgupta@mystartupcfo.com>', to: 'Sean <sean@callrevu.com>' },
        { from: 'Sean <sean@callrevu.com>', to: `me <${VIEWER}>` },
      ],
      VIEWER,
    );
    const sean = p.find((x) => x.address === 'sean@callrevu.com')!;
    expect(sean.sent).toBe(2);
    expect(sean.messages).toBe(3);
  });

  it('never suggests the viewer — they are already on the thread', () => {
    const p = deriveParticipants([{ from: `me <${VIEWER}>`, to: 'a@b.com' }], VIEWER);
    expect(p.map((x) => x.address)).not.toContain(VIEWER);
  });

  it('marks addresses outside the viewer domain as external', () => {
    const p = deriveParticipants([{ from: 'Sean <sean@callrevu.com>', to: 'x@mystartupcfo.com' }], VIEWER);
    expect(p.find((x) => x.address === 'sean@callrevu.com')!.external).toBe(true);
    expect(p.find((x) => x.address === 'x@mystartupcfo.com')!.external).toBe(false);
  });

  it('ranks senders above people who were only copied', () => {
    const p = deriveParticipants(
      [
        { from: 'writer@x.com', to: 'a@y.com', cc: 'lurker@z.com' },
        { from: 'writer@x.com', to: 'a@y.com', cc: 'lurker@z.com' },
      ],
      VIEWER,
    );
    expect(p[0].address).toBe('writer@x.com');
  });

  it('does not split a display name containing a comma', () => {
    const p = deriveParticipants([{ from: '"Gupta, Dolly" <dgupta@mystartupcfo.com>' }], VIEWER);
    expect(p).toHaveLength(1);
    expect(p[0].address).toBe('dgupta@mystartupcfo.com');
    expect(p[0].name).toBe('Gupta, Dolly');
  });

  it('is case-insensitive on addresses', () => {
    const p = deriveParticipants([{ from: 'A@X.com' }, { from: 'a@x.com' }], VIEWER);
    expect(p).toHaveLength(1);
    expect(p[0].messages).toBe(2);
  });

  it('handles a bare address with no angle brackets', () => {
    const p = deriveParticipants([{ from: 'plain@x.com' }], VIEWER);
    expect(p[0].address).toBe('plain@x.com');
  });
});

describe('droppedOff', () => {
  it('finds someone who was on the chain but is off the latest message', () => {
    const p = deriveParticipants(
      [
        { from: 'sean@callrevu.com', to: 'dolly@mystartupcfo.com, sid@mystartupcfo.com' },
        { from: 'dolly@mystartupcfo.com', to: 'sean@callrevu.com' },
      ],
      VIEWER,
    );
    expect(droppedOff(p).map((x) => x.address)).toContain('sid@mystartupcfo.com');
  });

  it('returns nobody when everyone is still on the latest message', () => {
    const p = deriveParticipants(
      [
        { from: 'a@x.com', to: 'b@x.com' },
        { from: 'a@x.com', to: 'b@x.com' },
      ],
      VIEWER,
    );
    expect(droppedOff(p)).toHaveLength(0);
  });
});
