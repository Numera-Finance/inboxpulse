import { describe, it, expect } from 'vitest';
import { nextActionsFor, calendarInviteUrl, newDocUrl } from './next-actions';
import type { Participant } from './participants';

const NOW = new Date(2026, 7, 13, 14, 20);
const P = (address: string, external: boolean): Participant => ({
  address, messages: 1, sent: 1, external, onLatest: true,
});
const PEOPLE = [P('sean@callrevu.com', true), P('dolly@mystartupcfo.com', false)];

describe('nextActionsFor', () => {
  it('puts the thread participants into the calendar draft on a scheduling thread', () => {
    // The alternative is retyping four addresses the user is already looking at.
    const [invite] = nextActionsFor({ mode: 'scheduling', subject: 'Re: Kickoff', participants: PEOPLE, now: NOW });
    expect(invite.label).toBe('Draft the invite');
    expect(decodeURIComponent(invite.url)).toContain('sean@callrevu.com,dolly@mystartupcfo.com');
    expect(invite.hint).toContain('2 people');
  });

  it('strips Re:/Fwd: so the invite is not titled "Re: Re: ..."', () => {
    const [invite] = nextActionsFor({ mode: 'scheduling', subject: 'Re: Kickoff', participants: PEOPLE, now: NOW });
    expect(decodeURIComponent(invite.url)).toContain('text=Kickoff');
    expect(decodeURIComponent(invite.url)).not.toContain('Re: Kickoff');
  });

  it('invites only the external side to an opportunity intro call', () => {
    const acts = nextActionsFor({ mode: 'opportunity', subject: 'New service', participants: PEOPLE, now: NOW });
    const invite = acts.find((a) => a.label === 'Draft the invite')!;
    expect(decodeURIComponent(invite.url)).toContain('sean@callrevu.com');
    expect(decodeURIComponent(invite.url)).not.toContain('dolly@mystartupcfo.com');
  });

  it('offers nothing on fyi — nothing is owed, so nothing is next', () => {
    expect(nextActionsFor({ mode: 'fyi', now: NOW })).toHaveLength(0);
  });

  it('offers nothing on working — reminders and tasks already cover it', () => {
    // Buttons added for symmetry are still buttons.
    expect(nextActionsFor({ mode: 'working', now: NOW })).toHaveLength(0);
  });

  it('offers nothing when the mode is unknown', () => {
    expect(nextActionsFor({ mode: undefined, now: NOW })).toHaveLength(0);
  });

  it('keeps the set short — three is a decision, six is a menu', () => {
    for (const mode of ['scheduling', 'opportunity', 'complaint'] as const) {
      expect(nextActionsFor({ mode, participants: PEOPLE, now: NOW }).length).toBeLessThanOrEqual(3);
    }
  });

  it('proposes the next hour rather than guessing a time from the thread', () => {
    // Wrong is expensive here and the user is about to pick anyway.
    const url = calendarInviteUrl({ title: 'x', attendees: [], now: NOW });
    expect(decodeURIComponent(url)).toContain('dates=20260813T150000/20260813T160000');
  });

  it('caps attendees so a 40-person thread does not build an unusable URL', () => {
    const many = Array.from({ length: 25 }, (_, i) => P(`p${i}@x.com`, true));
    const url = calendarInviteUrl({ title: 'x', attendees: many.map((m) => m.address), now: NOW });
    expect(decodeURIComponent(url).split('add=')[1].split('&')[0].split(',')).toHaveLength(10);
  });

  it('titles a new doc from the thread', () => {
    expect(decodeURIComponent(newDocUrl('Proposal — Kickoff'))).toContain('Proposal — Kickoff');
  });

  it('only ever produces URLs — no action creates a record silently', () => {
    // A real Calendar event needs a RESTRICTED scope and would block the
    // install every user has to approve. These open a prepared screen; the
    // human presses save.
    for (const mode of ['scheduling', 'opportunity', 'complaint'] as const) {
      for (const a of nextActionsFor({ mode, participants: PEOPLE, now: NOW })) {
        expect(a.url).toMatch(/^https:\/\//);
      }
    }
  });
});

describe('missing subject', () => {
  it('offers nothing rather than titling a calendar event "this thread"', () => {
    // That shipped: a real invite, four real attendees, titled "this thread".
    // A placeholder in a field the user is about to send to other people is
    // worse than no button.
    expect(nextActionsFor({ mode: 'scheduling', participants: PEOPLE, now: NOW })).toHaveLength(0);
    expect(nextActionsFor({ mode: 'scheduling', subject: '  ', participants: PEOPLE, now: NOW })).toHaveLength(0);
  });

  it('still works when the subject is only a Re: prefix away from empty', () => {
    expect(nextActionsFor({ mode: 'scheduling', subject: 'Re: ', participants: PEOPLE, now: NOW })).toHaveLength(0);
  });
});
