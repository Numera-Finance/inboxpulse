import { describe, it, expect } from 'vitest';
import { pushCard, type CardSection, type Widget } from './widgets';
import { buildHomepageCard } from './homepage';
import { buildThreadCard } from './thread';
import { signalNames } from './signals';

/** A section's real widgets, with the blank-line spacers dropped. */
const content = (section: CardSection): Widget[] =>
  section.widgets.filter((w) => !('textParagraph' in w && w.textParagraph.text.trim() === ''));

const rowsOf = (section: CardSection): { topLabel: string; text: string }[] =>
  content(section).map((w) => (w as { decoratedText: { topLabel: string; text: string } }).decoratedText);

describe('response envelope', () => {
  it('wraps a card in a bare RenderActions: action -> navigations -> pushCard (no renderActions key)', () => {
    const env = pushCard(buildHomepageCard(null));
    expect('renderActions' in env).toBe(false);
    const nav = env.action.navigations[0];
    expect(nav.pushCard).toBeDefined();
    expect(nav.pushCard.sections.length).toBeGreaterThan(0);
  });

  it('never prints the product name on the card — the add-on toolbar already shows it', () => {
    for (const card of [buildHomepageCard(null), buildThreadCard({ status: 'resolved', accountName: 'Acme' })]) {
      expect(card.header).toBeUndefined();
      expect(card.sections.map((s) => s.header)).not.toContain('InboxPulse');
    }
  });
});

describe('homepage card', () => {
  it('does not show pipeline volume', () => {
    // "Emails ingested 264,437 / Analyzed 82,782" was removed: it is a fact
    // about our pipeline, not the reader's day, and it cannot change what
    // anyone does next — the same test the label policy applies. It was also
    // occupying the space directly under the numbers that CAN be acted on.
    const flat = JSON.stringify(buildHomepageCard({ total: 174109, analyzed: 54477 }));
    expect(flat).not.toContain('174,109');
    expect(flat).not.toContain('54,477');
    expect(flat).not.toContain('This workspace');
  });

  it('shows preview copy when not connected', () => {
    expect(JSON.stringify(buildHomepageCard(null))).toContain('Preview mode');
  });
});

const openMessageSection = (card: { sections: Array<{ header?: string }> }) =>
  card.sections.find((s) => s.header === '<b>Open message</b>');

describe('thread card', () => {
  it('renders a resolved account + flags + escalation + message', () => {
    const flat = JSON.stringify(
      buildThreadCard({
        messageId: 'msg-f:123',
        status: 'resolved',
        accountName: 'Acme Inc',
        flags: ['At risk', 'Churn risk'],
        subject: 'Unhappy with the delays',
        fromEmail: 'cfo@acme.com',
        receivedAt: '2026-07-20T12:00:00.000Z',
        task: { done: false, assignee: 'V Mohan' },
      }),
    );
    expect(flat).toContain('Acme Inc');
    expect(flat).toContain('At risk, Churn risk');
    expect(flat).toContain('Unhappy with the delays');
    expect(flat).toContain('cfo@acme.com');
    expect(flat).toContain('Assigned to V Mohan');
    expect(flat).toContain('2026-07-20');
  });

  it('puts the envelope LAST, not first — Gmail already shows it', () => {
    const card = buildThreadCard({
      messageId: 'msg-f:123',
      status: 'resolved',
      accountName: 'Acme Inc',
      headers: {
        subject: 'Re: TR 2025 filing',
        from: 'Oliver Hahn <oliver@peak.insure>',
        to: 'v.mohan@mystartupcfo.com',
        cc: 'ap@peak.insure',
        bcc: 'audit@mystartupcfo.com',
      },
    });
    // The answer leads; the envelope is reference and comes last. Gmail shows
    // subject and sender inches away, so opening with them wasted the fold.
    const open = card.sections[card.sections.length - 1];
    expect(open.header).toBe('<b>Open message</b>');

    const rows = rowsOf(open);
    expect(rows.map((r) => r.topLabel)).toEqual(['Title', 'From', 'To', 'Cc', 'Bcc']);
    expect(rows[0].text).toBe('Re: TR 2025 filing');
    expect(rows[2].text).toBe('v.mohan@mystartupcfo.com');

    // The raw Gmail id is no longer surfaced anywhere on the card.
    expect(JSON.stringify(card)).not.toContain('msg-f:123');
  });

  it('renders every section heading in bold — the only emphasis Cards v2 offers', () => {
    const card = buildThreadCard({
      status: 'resolved',
      accountName: 'Acme Inc',
      subject: 'Re: TR 2025 filing',
      flags: ['At risk'],
      task: { done: false },
    });
    const headers = card.sections.map((s) => s.header).filter((h): h is string => Boolean(h));
    expect(headers.length).toBeGreaterThan(2);
    for (const h of headers) expect(h).toMatch(/^<b>.+<\/b>$/);
  });

  it('falls back to InboxPulse-side subject/sender when Gmail headers are unavailable', () => {
    const card = buildThreadCard({
      messageId: 'm',
      status: 'resolved',
      subject: 'Unhappy with the delays',
      fromEmail: 'cfo@acme.com',
    });
    const open = openMessageSection(card)!;
    const rows = rowsOf(open);
    expect(rows.map((r) => r.topLabel)).toEqual(['Title', 'From']);
    expect(rows[0].text).toBe('Unhappy with the delays');
  });

  it('says so plainly when nothing is known about the open message', () => {
    const open = openMessageSection(buildThreadCard({ status: 'preview' }))!;
    expect((open.widgets[0] as { textParagraph: { text: string } }).textParagraph.text).toContain(
      'No details available',
    );
  });

  it('marks a resolved escalation done', () => {
    const flat = JSON.stringify(
      buildThreadCard({ messageId: 'm', status: 'resolved', accountName: 'X', task: { done: true } }),
    );
    expect(flat).toContain('✓ Resolved');
    expect(flat).toContain('Unassigned');
  });

  it('shows preview text when not connected', () => {
    expect(JSON.stringify(buildThreadCard({ status: 'preview' }))).toContain('Preview mode');
  });

  it('shows the untracked-message state', () => {
    const flat = JSON.stringify(buildThreadCard({ messageId: 'x', status: 'untracked' }));
    // Assert the state is explained, not the exact sentence — the copy is
    // deliberately editable, but an untracked message must always say why it is
    // untracked and what would change that.
    expect(flat).toContain('Not a tracked client thread');
    expect(flat).toContain('Open a thread with a customer');
  });

  it('shows the open message even when the thread is untracked', () => {
    const flat = JSON.stringify(
      buildThreadCard({ messageId: 'x', status: 'untracked', headers: { subject: 'Internal note' } }),
    );
    expect(flat).toContain('Internal note');
    expect(flat).toContain('Not a tracked client thread');
  });

  it('shows the unidentified-workspace state', () => {
    const flat = JSON.stringify(buildThreadCard({ status: 'unidentified' }));
    expect(flat).toContain("isn't linked to an InboxPulse workspace");
    expect(flat).toContain('add-on homepage');
  });
});

describe('signalNames', () => {
  it('dedupes and maps codes to design labels', () => {
    expect(signalNames([2, 10, 30, 31])).toEqual(['Negative', 'At risk', 'Churn risk']);
  });
  it('is empty-safe', () => {
    expect(signalNames()).toEqual([]);
    expect(signalNames([999])).toEqual([]);
  });
});

/**
 * The management sections must name people and clients, not just count them.
 *
 * "Account managers carrying it" was retired here. It counted unanswered angry
 * threads per person and had stopped saying anything — its top real manager
 * carried two. What a manager actually asks is where the damage is and who to
 * call about it, so the same population is now shown by CLIENT with the owner
 * named on the row, alongside a per-person reply-time median.
 */
describe('where the fires are', () => {
  const fires = {
    webUrl: 'https://example.test',
    windowDays: 90,
    fires: [
      {
        customerId: 'c1',
        customer: 'Deserve, Inc.',
        negative: 18,
        unanswered: 8,
        oldestDays: 74,
        owner: 'Sukrati Gupta',
      },
      {
        customerId: 'c2',
        customer: 'Truefoundry',
        negative: 9,
        unanswered: 6,
        oldestDays: 59,
        owner: null,
      },
    ],
  };
  const card = (): string =>
    JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, fires),
    );

  it('names the client and the damage', () => {
    expect(card()).toContain('Deserve, Inc.');
    expect(card()).toContain('8 unanswered');
  });

  /** A fire without a name attached is an observation, not an action. */
  it('names the account manager to call', () => {
    expect(card()).toContain('Sukrati Gupta');
  });

  /**
   * An unallocated client with six unanswered complaints is a WORSE finding
   * than an allocated one. Hiding the null would hide the worst cases.
   */
  it('says so when nobody owns the client, rather than omitting the row', () => {
    expect(card()).toContain('Truefoundry');
    // A blank owner always means the client is absent from the allocation
    // sheet, never "assigned to someone else" — every matched client has an
    // Account manager. Saying so points the reader at the real fix.
    expect(card()).toContain('not on the allocation sheet');
  });

  /**
   * The escalations page reads `customer`, not `customerId`. A wrong param does
   * not error — the page loads unfiltered — so the link would look like it
   * worked while showing everything.
   */
  it('deep-links with the param name the escalations route reads', () => {
    expect(card()).toContain('customer=c1');
    expect(card()).not.toContain('customerId=');
  });
});

describe('slowest to answer angry mail', () => {
  const slow = {
    firmMedianH: 12.9,
    people: [
      { name: 'Ganesh Shankar', threads: 10, medianH: 79.3 },
      { name: 'Meghana Muralidhar Murthy', threads: 22, medianH: 50.1 },
    ],
  };
  const card = (): string =>
    JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, undefined, slow),
    );

  it('names the person and compares them to the firm', () => {
    expect(card()).toContain('Ganesh Shankar');
    // A multiple, not two durations in different units — "3d vs 12.9h" made
    // the reader convert mid-sentence to find out whether 3d was bad.
    expect(card()).toContain('the firm');
    expect(card()).toMatch(/[0-9.]+×/);
  });

  /**
   * The sample size is not optional. A median over ten threads is thin, and a
   * person named as slowest cannot argue with a number whose basis is hidden.
   */
  it('shows the sample the median rests on', () => {
    expect(card()).toContain('10 answered threads');
  });

  /**
   * Only ANSWERED threads have a duration, so someone who never replies at all
   * cannot appear here and looks better than someone who replies slowly. That
   * limitation has to be on the card, not just in a comment.
   */
  it('states that unanswered mail is excluded', () => {
    // Kept short: a caveat nobody finishes is a caveat nobody has.
    expect(card()).toContain('Answered mail only');
  });
});

/**
 * The panel must not apologise for a section it is rendering.
 *
 * "Per-person breakdown needs reply attribution: 12% of replies currently
 * identify who sent them" was true about the route it assumed — first_reply_by_id
 * is 7-12% populated, because replies are matched for a timestamp and then
 * discarded, so nothing can be attributed by AUTHORSHIP. "Slowest to answer
 * angry mail" answers the same question through the allocation sheet, which
 * names one accountable person per client. See ADR-022.
 */
describe('no stale unavailability notice', () => {
  it('does not claim a per-person breakdown is unavailable', () => {
    const flat = JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, {
        windowDays: 90,
        negativeMedianH: 12.9,
        otherMedianH: 15.1,
        negativeP90H: 139,
        negativeCount: 505,
        trend: [{ month: '2026-05', medianH: 14 }, { month: '2026-08', medianH: 12 }],
        attributionPct: 12,
      }),
    );
    expect(flat).toContain('to first reply');
    expect(flat).not.toContain('Per-person breakdown needs');
  });
});

/**
 * "Preview mode" must mean nothing came back, not that one call failed.
 *
 * Seen in production: the banner keyed off getEmailStats alone, whose display
 * block had been removed, so a failing stats call printed "not connected to the
 * InboxPulse API" directly above a live median of 12.9h over 505 real replies.
 * That undermines every number on the card — a reader told the panel is in
 * preview mode has no reason to trust the figures beside the message.
 */
describe('preview-mode banner', () => {
  const PULSE = {
    windowDays: 90,
    negativeMedianH: 12.9,
    otherMedianH: 15.1,
    negativeP90H: 139,
    negativeCount: 505,
    trend: [{ month: '2026-05', medianH: 14 }, { month: '2026-08', medianH: 12 }],
    attributionPct: 12,
  };

  it('is absent when live data arrived, even with no stats', () => {
    const flat = JSON.stringify(buildHomepageCard(null, undefined, undefined, undefined, PULSE));
    expect(flat).toContain('to first reply');
    expect(flat).not.toContain('Preview mode');
  });

  it('is absent when only the fires list arrived', () => {
    const flat = JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, {
        webUrl: 'https://web.test',
        windowDays: 90,
        fires: [{ customerId: 'c1', customer: 'Deserve, Inc.', negative: 18, unanswered: 8, oldestDays: 74, owner: 'S G' }],
      }),
    );
    expect(flat).not.toContain('Preview mode');
  });

  it('still appears when the whole internal API is unreachable', () => {
    expect(JSON.stringify(buildHomepageCard(null))).toContain('Preview mode');
  });
});

/**
 * The tail leads; the median is context.
 *
 * The section opened with the median, and the median is the part that is
 * already fine — 12.9h against 15.1h for routine mail, so half of unhappy
 * clients hear back the same working day. A lead reading that concluded things
 * were acceptable, which was true and useless.
 *
 * The damage is in the tail: 56 of 505 answered negative threads waited over
 * five days, and those are the clients who leave. A COUNT OF PEOPLE, not a
 * percentile — nobody can picture "p90", and a percentile shifts when the
 * population changes, so it cannot be tracked month to month by a human.
 */
describe('unhappy clients left waiting', () => {
  const PULSE = {
    windowDays: 90,
    negativeMedianH: 12.9,
    otherMedianH: 15.1,
    negativeP90H: 143.3,
    negativeCount: 505,
    overFiveDays: 56,
    trend: [{ month: '2026-05', medianH: 39.3 }, { month: '2026-08', medianH: 12 }],
    attributionPct: 13,
  };
  const card = (): string =>
    JSON.stringify(buildHomepageCard(null, undefined, undefined, undefined, PULSE));

  it('leads with the count of clients who waited too long', () => {
    expect(card()).toContain('56');
    expect(card()).toContain('waited more than');
    expect(card()).toContain('5 days');
  });

  it('still shows the median, below, with its comparison', () => {
    expect(card()).toContain('12.9h');
    expect(card()).toContain('faster than routine mail');
  });

  /** Two statements of one fact read as two facts. */
  it('drops the p90 row, which said the same thing unactionably', () => {
    expect(card()).not.toContain('1 in 10 waits');
  });

  /** The header must name its own subject — "carrying it" left "it" undefined. */
  it('names what is being counted in the header', () => {
    expect(card()).toContain('Unhappy clients left waiting');
  });
});

/**
 * Design: the panel must not go quiet when it has nothing to say.
 *
 * An empty section and a forbidden section are indistinguishable once both are
 * absent, and only one is good news. A viewer with role `User` and zero
 * accessible customers saw no fires and no waiting clients, beside tenant-wide
 * sections showing real data — it read as the feature being missing rather than
 * as a permissions problem.
 */
describe('restricted viewer', () => {
  it('says why the section is empty instead of omitting it', () => {
    const flat = JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, {
        restricted: true,
        windowDays: 90,
        fires: [],
        webUrl: 'https://web.test',
      }),
    );
    expect(flat).toContain('Where the fires are');
    expect(flat).toContain('No client access');
  });

  it('stays silent when there is genuinely nothing on fire', () => {
    const flat = JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, {
        restricted: false,
        windowDays: 90,
        fires: [],
        webUrl: 'https://web.test',
      }),
    );
    expect(flat).not.toContain('No client access');
  });
});

/**
 * Design: a multiple, not two durations in different units.
 *
 * The row read "3d vs 12.9h firm-wide" and asked the reader to convert units
 * mid-sentence to learn whether 3d was bad. The comparison carries the meaning,
 * so it leads; the absolute number moves to the small line beneath.
 */
describe('slow responder rows', () => {
  it('leads with a multiple of the firm median', () => {
    const flat = JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, undefined, {
        firmMedianH: 12.9,
        people: [{ name: 'Ganesh Shankar', threads: 11, medianH: 60.8 }],
      }),
    );
    expect(flat).toContain('4.7×');
    expect(flat).toContain('the firm');
    expect(flat).not.toContain('vs 12.9h firm-wide');
  });
});

/**
 * A deep link must land on the population its row just claimed.
 *
 * The escalations page defaults to subDays(new Date(), 30) while this section
 * counts 90 days, so a link without a range dropped everything older than a
 * month: Falconx read "5 unanswered, oldest 50d" and the page answered "No
 * analyzed emails found" — which reads as the panel inventing numbers.
 *
 * And on that page `status=open` means an open TASK, while the section means
 * "nobody replied". Different populations; asserting the wrong one hides rows
 * the row itself counted.
 */
describe('fires deep link', () => {
  const url = (): string => {
    const flat = JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, {
        webUrl: 'https://web.test',
        windowDays: 90,
        fires: [
          { customerId: 'c1', customer: 'Falconx', negative: 6, unanswered: 5, oldestDays: 50, owner: null },
        ],
      }),
    );
    return decodeURIComponent(flat);
  };

  it('carries a date range matching the window the row was counted over', () => {
    expect(url()).toContain('from=');
    const m = url().match(/from=(\d{4}-\d{2}-\d{2})/);
    expect(m).not.toBeNull();
    const days = Math.round((Date.now() - new Date(m![1]).getTime()) / 86400000);
    expect(days).toBeGreaterThanOrEqual(89);
    expect(days).toBeLessThanOrEqual(91);
  });

  it('does not assert status=open, which means an open task, not an unanswered thread', () => {
    expect(url()).toContain('status=all');
    expect(url()).not.toContain('status=open&customer');
  });
});

/**
 * Name the role, and say what is actually wrong when there is nobody.
 *
 * The row read only role = 'Account manager', so a client with a Controller, an
 * Accountant and two Bookkeepers on the sheet still rendered "no account
 * manager" — true, and useless to someone deciding who to call.
 *
 * And a blank owner never means "assigned to someone else": measured on
 * production, every matched client has an Account manager, so it always means
 * the client is absent from the allocation sheet. That is a different
 * instruction to the reader — go add them, not go find them.
 */
describe('fire row ownership', () => {
  const card = (owner: string | null, ownerRole: string | null): string =>
    JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, {
        webUrl: 'https://web.test',
        windowDays: 90,
        fires: [{ customerId: 'c1', customer: 'Falconx', negative: 6, unanswered: 5, oldestDays: 50, owner, ownerRole }],
      }),
    );

  it('names a non-manager role, so the reader knows who they are getting', () => {
    expect(card('Manpreet Kaur Saini', 'Accountant')).toContain('Manpreet Kaur Saini · Accountant');
  });

  it('does not clutter the row when the person is the account manager', () => {
    expect(card('Ganesh Shankar', 'Account manager')).toContain('Ganesh Shankar');
    expect(card('Ganesh Shankar', 'Account manager')).not.toContain('· Account manager');
  });

  it('says the client is off the sheet rather than blaming a missing manager', () => {
    expect(card(null, null)).toContain('not on the allocation sheet');
    expect(card(null, null)).not.toContain('no account manager');
  });
});

/**
 * When two people share a role, say so instead of picking one.
 *
 * 61 client/role pairs on the sheet have two people. Deserve, Inc. has two
 * account managers, and with no tiebreak the row showed Sukrati Gupta on one
 * render and Neeraja Suryadevara on the next — a name that changes between
 * refreshes is worse than either name. The query is now deterministic, and the
 * row admits the co-holder rather than presenting one of two as THE owner.
 */
describe('shared roles', () => {
  const card = (peers: number): string =>
    JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, {
        webUrl: 'https://web.test',
        windowDays: 90,
        fires: [{
          customerId: 'c1', customer: 'Deserve, Inc.', negative: 16, unanswered: 6,
          oldestDays: 74, owner: 'Neeraja Suryadevara', ownerRole: 'Account manager', ownerPeers: peers,
        }],
      }),
    );

  it('marks that another person holds the same role', () => {
    expect(card(2)).toContain('Neeraja Suryadevara +1');
  });

  it('stays clean when the person is the only holder', () => {
    expect(card(1)).toContain('Neeraja Suryadevara');
    expect(card(1)).not.toContain('+0');
    expect(card(1)).not.toContain('+1');
  });
});

/**
 * A person row needs somewhere to go, but not a dishonest one.
 *
 * The median is computed over threads on the clients they own by the allocation
 * sheet; the escalations page can only filter by TASK ASSIGNEE, and the two
 * disagree — Ganesh Shankar has 22 negative threads on his clients and 12 with
 * a task assigned to him. A button promising the row's own population would
 * land on a smaller one, which is the contradiction the fires link had.
 */
describe('slow responder link', () => {
  const view = (userId: string | null) => ({
    firmMedianH: 12.9,
    webUrl: 'https://web.test',
    windowDays: 90,
    people: [{ name: 'Ganesh Shankar', userId, threads: 13, medianH: 115 }],
  });
  const card = (userId: string | null): string =>
    JSON.stringify(buildHomepageCard(null, undefined, undefined, undefined, undefined, undefined, view(userId)));

  it('names the destination rather than the number', () => {
    expect(card('u-1')).toContain('Their queue');
    expect(card('u-1')).not.toContain('See these');
  });

  it('filters by the person and matches the median window', () => {
    expect(decodeURIComponent(card('u-1'))).toContain('assigned=u-1');
    expect(card('u-1')).toContain('from=');
  });

  /** A row with nowhere honest to go keeps no button at all. */
  it('omits the button when the person cannot be resolved', () => {
    expect(card(null)).toContain('Ganesh Shankar');
    expect(card(null)).not.toContain('Their queue');
  });
});

/**
 * One rule, at the boundary that means something.
 *
 * Gmail draws a hairline between every card section and Cards v2 exposes no
 * control over it — no weight, no colour, no inset, no suppression. The only
 * lever is how many SECTIONS exist. Six sections gave six identical rules, so
 * the break between two client metrics looked exactly like the break between
 * the firm's data and the reader's own mailbox: every boundary shouting
 * equally, which means none of them says anything.
 *
 * This test is a design regression guard. Adding a section is adding a rule.
 */
describe('card structure', () => {
  const full = () =>
    buildHomepageCard(
      null,
      { entries: [{ label: { key: 'f', name: '⚡/Focus', means: 'x' }, threadId: 't', subject: 'S', minutesLeft: 20 }],
        viewerEmail: 'g@x.com', threadUrl: () => 'https://m.test' },
      'https://addon.test',
      { clients: [{ customerId: 'c', customer: 'X', subject: 's', daysWaiting: 3 }], webUrl: 'https://w.test' },
      { windowDays: 90, negativeMedianH: 12.9, otherMedianH: 15.1, negativeP90H: 143, negativeCount: 501,
        overFiveDays: 56, trend: [{ month: '2026-05', medianH: 39 }, { month: '2026-08', medianH: 12 }], attributionPct: 13 },
      { fires: [{ customerId: 'c1', customer: 'Truefoundry', negative: 2, unanswered: 2, oldestDays: 54, owner: null }],
        windowDays: 90, webUrl: 'https://w.test' },
      { firmMedianH: 12.9, webUrl: 'https://w.test', windowDays: 90,
        people: [{ name: 'Ganesh Shankar', userId: 'u1', threads: 13, medianH: 115 }] },
    );

  it('renders two sections even when every block has data', () => {
    expect(full().sections.length).toBe(2);
  });

  it('keeps the client blocks together, above the divide', () => {
    const firstSection = JSON.stringify(full().sections[0]);
    expect(firstSection).toContain('Where the fires are');
    expect(firstSection).toContain('Unhappy clients left waiting');
    expect(firstSection).toContain('Slowest to answer angry mail');
    expect(firstSection).not.toContain('Prioritise my inbox');
  });

  it('keeps the reader\'s own tools together, below it', () => {
    const second = JSON.stringify(full().sections[1]);
    expect(second).toContain('Your inbox');
    expect(second).toContain('Prioritise my inbox');
    expect(second).toContain('Your marked threads');
    expect(second).toContain('Open web dashboard');
  });
});

/**
 * The promise must appear before anything is read, and must not overclaim.
 *
 * Written for a reader who has said he is sensitive about his mail being read.
 * Every line is tied to something the code enforces — see services/consent.ts —
 * and the uncomfortable one is stated in the same weight as the reassuring
 * ones. A privacy notice that omits the third party is worse than none: it
 * teaches the reader that the rest was drafted to soothe.
 */
describe('privacy block', () => {
  const card = (readingOn: boolean): string =>
    JSON.stringify(
      buildHomepageCard(null, undefined, 'https://addon.test', undefined, undefined,
        undefined, undefined, { readingOn }),
    );

  it('says nothing is being read until it is turned on', () => {
    expect(card(false)).toContain('Your mail is not being read');
    expect(card(false)).toContain('Turn on reading');
  });

  it('names Gemini rather than hiding the third party', () => {
    expect(card(false)).toContain('Gemini');
  });

  it('makes all three promises, not just the comfortable ones', () => {
    const c = card(false);
    expect(c).toContain('Only if you turn it on');
    expect(c).toContain('Nothing is kept');
    expect(c).toContain('Only you see it');
  });

  it('offers a way out once it is on', () => {
    expect(card(true)).toContain('Reading is on');
    expect(card(true)).toContain('Stop reading my mail');
    expect(card(true)).not.toContain('Turn on reading');
  });
});

/**
 * An install that can write to the mailbox must say what it writes.
 *
 * The full deployment carries gmail.modify because attaching a label to a
 * thread needs users.threads.modify — gmail.labels manages definitions, not
 * attachments, so there is no narrower scope. Its consent screen reads "Read,
 * compose, and send emails from your Gmail account", the broadest sentence
 * Google shows short of full access. Nothing in the product can soften that, so
 * the product names the single write and shows the undo beside it.
 */
describe('write disclosure', () => {
  const card = (canWrite: boolean): string =>
    JSON.stringify(
      buildHomepageCard(null, undefined, 'https://addon.test', undefined, undefined,
        undefined, undefined, { readingOn: false, canWrite }),
    );

  it('names the one thing written, and the undo, when the scope is present', () => {
    expect(card(true)).toContain('One thing gets written');
    expect(card(true)).toContain('never on mail you have not touched');
    expect(card(true)).toContain('Clear all my marks');
  });

  it('claims no write on an install that cannot make one', () => {
    expect(card(false)).not.toContain('One thing gets written');
  });
});

/**
 * A comparison must not mix units.
 *
 * The row read "5d median · firm 12.8h" — days against hours, forcing the
 * reader to convert mid-line to see whether 5d was bad. That is the same defect
 * the headline multiple was introduced to remove, left sitting directly beneath
 * it. The larger value now picks the unit for both.
 */
describe('slow responder sub-line units', () => {
  const sub = (medianH: number, firmMedianH: number): string =>
    JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, undefined, {
        firmMedianH,
        webUrl: 'https://web.test',
        windowDays: 90,
        people: [{ name: 'Ganesh Shankar', userId: 'u1', threads: 13, medianH }],
      }),
    );

  it('renders both sides in days when the person is measured in days', () => {
    const out = sub(120, 12.8);
    expect(out).toContain('5.0d median · firm 0.5d');
    expect(out).not.toContain('firm 12.8h');
  });

  it('renders both sides in hours when neither reaches a day', () => {
    expect(sub(25.6, 12.8)).toContain('25.6h median · firm 12.8h');
  });
});

describe('the fire arc', () => {
  const withFires = (arc?: number[]) =>
    JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, {
        webUrl: 'https://web.test',
        windowDays: 90,
        fires: [{
          customerId: 'c1', customer: 'PureCipher', negative: 4, unanswered: 2,
          oldestDays: 9, owner: 'Ana Diaz', ownerRole: 'Account manager', arc,
        }],
      }),
    );

  it('shows the trajectory when there is one', () => {
    // A count cannot separate a client getting worse from one who has always
    // been difficult, and those are different calls. Measured across 693
    // client-months, crossing 10% is a step change that does not revert.
    // First and last only — the full arc overflowed the label and Gmail
    // truncated it, hiding the count that was already there.
    const json = withFires([5, 7, 36]);
    // The word does the triage; the numbers let a reader check it.
    expect(json).toContain('Rising 5%→36%');
    // The row must stay readable: the total count is dropped because
    // "4 unhappy" and "2 unanswered" read as the same number, and unanswered is
    // the half the firm controls.
    expect(json).not.toContain('unhappy');
    // The count stays on the medium line with the name; the age moves to grey,
    // so a long client name cannot orphan the number onto its own line.
    expect(json).toContain('2 unanswered');
    expect(json).not.toContain('unanswered</b></font>, oldest');
  });

  it('needs two months before it can show a direction', () => {
    expect(withFires([12])).not.toContain('→');
  });

  it('says Cooling when the client is coming down', () => {
    // A client climbing from nothing and one falling from a peak looked
    // identical as bare numbers, and they need opposite calls.
    expect(withFires([25, 9])).toContain('Cooling 25%→9%');
  });

  it('falls back to the count when a client has too little mail to rate', () => {
    // Months under six emails are dropped upstream — one angry email out of two
    // is 50% and means nothing.
    // Age now lives in the red span on the medium line, not a grey top label.
    const json = withFires();
    expect(json).toContain('9d');
    expect(json).not.toContain('→');
  });
});

describe('the engagement marker on a fire', () => {
  const withEngaged = (engaged?: boolean) =>
    JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, {
        webUrl: 'https://web.test',
        windowDays: 90,
        fires: [{
          customerId: 'c1', customer: 'PureCipher', negative: 4, unanswered: 2,
          oldestDays: 9, owner: 'Ana Diaz', ownerRole: 'Account manager',
          arc: [5, 7, 36], engaged,
        }],
      }),
    );

  it('marks a client we are actually talking to', () => {
    // The strongest predictor measured anywhere in this panel: within the fires
    // list, engaged clients complain again next week 24.7% of the time against
    // 13.0% for the rest. It also decides the sort order, so a reader who cannot
    // see it reads the order as arbitrary.
    expect(withEngaged(true)).toContain('In conversation');
  });

  it('leads with it, ahead of the trajectory', () => {
    // Placement is the claim. It sorts first, so it reads first.
    const json = withEngaged(true);
    expect(json.indexOf('In conversation')).toBeLessThan(json.indexOf('Rising'));
  });

  it('says nothing when we are not in the conversation', () => {
    // A marker on every row is a column heading, not a signal.
    expect(withEngaged(false)).not.toContain('In conversation');
  });

  it('says nothing against an older API that does not send the field', () => {
    // The addon and crm-api deploy independently and the addon has shipped
    // ahead before. Absent must render as no marker, never as a wrong one.
    expect(withEngaged()).not.toContain('In conversation');
  });
});

describe('talking more than usual', () => {
  const card = (stirring: Array<{ customer: string; customerId: string | null; recent: number; usual: number; owner: string | null }>) =>
    JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, undefined, undefined, undefined, stirring),
    );

  it('names the client and both numbers', () => {
    const json = card([{ customer: 'Hinlab Inc', customerId: 'c1', recent: 20, usual: 5, owner: 'Ana Diaz' }]);
    expect(json).toContain('Hinlab Inc');
    expect(json).toContain('20 this week');
    expect(json).toContain('usually 5 a week');
  });

  it('states volume without asserting a mood', () => {
    // Causation is unsettled: a busy month makes both more mail and more chances
    // for friction. The row must not claim the client is unhappy.
    const json = card([{ customer: 'Hinlab Inc', customerId: 'c1', recent: 20, usual: 5, owner: null }]);
    expect(json).not.toMatch(/unhappy|angry|frustrat|complain/i);
  });

  it('says nothing when no client is stirring', () => {
    expect(card([])).not.toContain('Talking more than usual');
  });

  it('admits when nobody owns the client', () => {
    const json = card([{ customer: 'Hinlab Inc', customerId: 'c1', recent: 20, usual: 5, owner: null }]);
    expect(json).toContain('not on the allocation sheet');
  });
});
