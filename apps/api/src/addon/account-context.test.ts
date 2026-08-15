// The services carry tsyringe decorators, which need the polyfill at load time.
import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '@crm/database';
import {
  AccountContextService,
  WaitingClientsService,
  DangerPulseService,
  OwnerLoadService,
  SlowRespondersService,
  __resetRelationshipsTableCache,
} from './account-context';

/**
 * Every management metric must require somebody from this firm on the thread.
 *
 * This is a regression test for a live wrong answer, not a style rule. We sync
 * our own mailboxes, including the per-client group ids a team listens on, and
 * clients auto-forward into those addresses so their bookkeeper sees the
 * traffic. A forwarded message keeps its original `To:`, so no address of ours
 * appears on it — one client contributed 925 threads of which 786 have no
 * address of ours anywhere. Scoring "unhappy client, nobody replied" over that
 * corpus measures the CLIENT's own customer service and books the result
 * against an account manager who was never on the thread. Two named people were
 * on that list for threads they had never seen. See ADR-020.
 *
 * The check is structural on purpose. The predicate is a SQL fragment, so the
 * behavioural version needs a database and lives with the skipped integration
 * tests. What this catches is the cheap and likely regression: a fourth service
 * added without it, or the fragment dropped from one of the three call sites
 * while the other two keep it — which fails silently, because a metric missing
 * this predicate returns MORE rows rather than none.
 */

/** A database that records the SQL it is handed and returns nothing. */
function recordingDb(): { db: Database; sql: () => string } {
  const seen: string[] = [];
  const db = {
    execute: (query: unknown): Promise<unknown[]> => {
      // Drizzle's SQL object carries its fragments on `queryChunks`. Stringify
      // the whole thing rather than reaching for internals by name: the test
      // only needs to know whether the predicate is present in what was built.
      const text = JSON.stringify(query);
      seen.push(text);
      // Answer the catalogue probe, so the services build the SQL they would
      // build against a migrated database. Returning [] here would silently
      // exercise the DEGRADED path and make these assertions meaningless.
      if (text.includes('to_regclass')) return Promise.resolve([{ ok: true }]);
      return Promise.resolve([]);
    },
  } as unknown as Database;
  return { db, sql: () => seen.join('\n') };
}

beforeEach(() => __resetRelationshipsTableCache());

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('management metrics require a firm participant on the thread', () => {
  it('WaitingClientsService filters to threads we are on', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).toContain('participant_type');
  });

  it('DangerPulseService filters to threads we are on', async () => {
    const { db, sql } = recordingDb();
    await new DangerPulseService(db).get(TENANT, 90);
    expect(sql()).toContain('participant_type');
  });

  it('OwnerLoadService filters to threads we are on', async () => {
    const { db, sql } = recordingDb();
    await new OwnerLoadService(db).get(TENANT, 30);
    expect(sql()).toContain('participant_type');
  });

  /**
   * The predicate must be evaluated over the whole thread.
   *
   * The flagged message is inbound FROM the client by construction — that is
   * what makes it a complaint nobody answered. A message-level test would
   * therefore exclude every thread it is meant to keep, and the sections would
   * go empty rather than wrong. Asserting the correlated subquery joins on
   * thread_id pins the distinction that makes this work at all.
   */
  it('matches across the thread, not the single message', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).toContain('e2.thread_id');
  });
});

/**
 * Customers marked as non-clients must be excluded from client reviews.
 *
 * The own-domain rule counts staff accounts on a domain, which catches
 * mystartupcfo.com and misses an outsourced delivery partner completely — from
 * the mail alone, a CA practice doing our back-office work looks exactly like a
 * client, and the allocation grid cannot distinguish it either (role-holders
 * are 100% mystartupcfo.com). So the verdict is recorded in
 * customer_relationships rather than derived, and rather than hardcoded: the
 * previous attempt at hardcoding put `blueoceanps` in a constant and silently
 * dropped a real customer with 45 threads from the review.
 */
describe('non-client customers are excluded', () => {
  it('WaitingClientsService consults customer_relationships', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).toContain('customer_relationships');
  });

  it('OwnerLoadService consults customer_relationships', async () => {
    const { db, sql } = recordingDb();
    await new OwnerLoadService(db).get(TENANT, 30);
    expect(sql()).toContain('customer_relationships');
  });

  /**
   * Absence must mean CLIENT, never the reverse.
   *
   * Only non-clients are ever inserted, so the filter has to be a NOT EXISTS. If
   * it were ever inverted into a requirement that a row be present, every
   * customer would vanish from every section at once — and silently, because an
   * empty section looks like good news.
   */
  it('excludes on presence of a row, so an unlisted customer stays a client', async () => {
    const { db, sql } = recordingDb();
    await new OwnerLoadService(db).get(TENANT, 30);
    // Skip the to_regclass probe, which names the table without filtering on it.
    const q = sql()
      .split('\n')
      .filter((line) => !line.includes('to_regclass'))
      .join('\n');
    const at = q.indexOf('customer_relationships');
    expect(at).toBeGreaterThan(-1);
    expect(q.slice(Math.max(0, at - 400), at)).toContain('NOT EXISTS');
  });
});

/**
 * A database without the migration must DEGRADE, not 500.
 *
 * The table arrives by hand-applied migration, so a deploy can reach production
 * before the SQL does — a first attempt did exactly that and turned every
 * management section into a 500. Degrading excludes nobody, which is identical
 * to the table being empty and is the direction the whole design takes: a
 * partner firm reappearing in the review is visible, a client vanishing is not.
 */
describe('missing customer_relationships table', () => {
  it('omits the filter instead of failing', async () => {
    const seen: string[] = [];
    const db = {
      execute: (q: unknown): Promise<unknown[]> => {
        const text = JSON.stringify(q);
        seen.push(text);
        // to_regclass returns NULL for a missing relation.
        if (text.includes('to_regclass')) return Promise.resolve([{ ok: false }]);
        return Promise.resolve([]);
      },
    } as unknown as Database;

    await new OwnerLoadService(db).get(TENANT, 30);
    const queries = seen.filter((q) => !q.includes('to_regclass'));
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q).not.toContain('customer_relationships');
  });
});

/**
 * The own-domain filter must emit a real ARRAY, not a row constructor.
 *
 * `<> ALL(${jsArray})` renders in drizzle as `ALL(($3, $4))`, which Postgres
 * parses as a ROW CONSTRUCTOR:
 *
 *   ERROR: op ANY/ALL (array) requires array on right side
 *
 * The whole statement failed, so /api/internal/addon/waiting returned 500 for
 * every request. That failure is invisible in the panel — the client swallows a
 * non-OK response, returns [], and the section does not render, which reads as
 * "no angry clients waiting". The most reassuring possible result, produced by a
 * crash. It was live in production and only surfaced while chasing something
 * else.
 */
describe('own-domain exclusion', () => {
  it('emits ARRAY[...]::text[], not a parenthesised list', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: ['mystartupcfo.com', 'numerafinance.com'] },
    );
    const q = sql();
    expect(q).toContain('ARRAY[');
    expect(q).toContain('::text[]');
    // The exact broken shape: ALL( immediately followed by an open paren.
    expect(q).not.toMatch(/ALL\(\s*\(/);
  });

  it('omits the filter entirely when there are no own domains', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).not.toContain('ARRAY[');
  });
});

/**
 * A table that appears mid-process must be picked up.
 *
 * Tables arrive by hand-applied migration and never disappear, so caching a
 * NEGATIVE result pins an instance to the degraded path for its whole life.
 * That happened: the migration was applied while crm-api was serving, every
 * warm instance kept excluding nobody, and the partner firm seeded seconds
 * earlier still ranked in the fires list — indistinguishable from the seed
 * having failed.
 */
describe('relationships-table probe', () => {
  it('re-probes after a miss, and stops probing once found', async () => {
    __resetRelationshipsTableCache();
    let exists = false;
    let probes = 0;
    const db = {
      execute: (q: unknown): Promise<unknown[]> => {
        if (JSON.stringify(q).includes('to_regclass')) {
          probes += 1;
          return Promise.resolve([{ ok: exists }]);
        }
        return Promise.resolve([]);
      },
    } as unknown as Database;

    await new OwnerLoadService(db).get(TENANT, 30);
    expect(probes).toBe(1);

    // Still missing — must ask again rather than trust the cached miss.
    await new OwnerLoadService(db).get(TENANT, 30);
    expect(probes).toBe(2);

    // Migration lands.
    exists = true;
    await new OwnerLoadService(db).get(TENANT, 30);
    expect(probes).toBe(3);

    // Now cached: no further catalogue lookups.
    await new OwnerLoadService(db).get(TENANT, 30);
    expect(probes).toBe(3);
  });
});

/**
 * Every management service must apply the same exclusions.
 *
 * WaitingClientsService was the odd one out: no is_auto_created filter, so it
 * listed customers the ingester invented from a sender domain. "Justworks
 * (Auto)" — a payroll provider, our vendor and never our client — appeared as
 * an angry client nobody had answered, and clicking through found nothing,
 * because there was nothing. The row was an artefact of weaker filtering than
 * the section beside it.
 */
describe('exclusions are consistent across services', () => {
  const services: Array<[string, (db: Database) => Promise<unknown>]> = [
    ['WaitingClientsService', (db) =>
      new WaitingClientsService(db).find(TENANT, { userId: 'u1', isAdmin: true }, { days: 90, limit: 10, ownDomains: [] })],
    ['OwnerLoadService', (db) => new OwnerLoadService(db).get(TENANT, 30)],
  ];

  for (const [name, run] of services) {
    it(`${name} excludes auto-created customers`, async () => {
      const { db, sql } = recordingDb();
      await run(db);
      expect(sql()).toContain('is_auto_created');
    });

    it(`${name} excludes domains the firm staffs`, async () => {
      const { db, sql } = recordingDb();
      await run(db);
      expect(sql()).toContain('customer_domains');
    });
  }
});

/**
 * "Unanswered" must mean we were asked and did not reply.
 *
 * A client wrote to their own payroll provider — elle@thesis.inc to
 * support@justworks.com — on a thread we appear on elsewhere. Negative, no
 * reply from us, and correctly so: nobody asked us anything. It ranked as an
 * angry client we had ignored, which is a false accusation rather than a
 * miscount.
 */
describe('the angry message must address us', () => {
  it('WaitingClientsService requires a staff recipient on the flagged message', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).toContain("me.direction IN ('to', 'cc')");
  });

  /**
   * Recipient, not sender. The flagged message is inbound FROM the client by
   * construction, so testing for a staff sender would exclude every row the
   * section exists to show.
   */
  it('tests recipients, not senders', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).not.toContain("me.direction IN ('from')");
  });
});

/**
 * A thread a human already closed is not unanswered.
 *
 * "Unanswered" was first_reply_at IS NULL alone, and that column is only as
 * good as the reply matcher — replies are matched for a timestamp then
 * discarded, so it is null far more often than a client is really waiting.
 * Truefoundry showed 7 unanswered while the web view showed 4 of 6 resolved;
 * tenant-wide the count falls from 379 to 83.
 *
 * TaskStatus.DONE is 1 and OPEN is 0, which reads backwards to most people —
 * getting it the wrong way round silently inverts the metric.
 */
describe('already-resolved threads', () => {
  it('WaitingClientsService excludes threads with a DONE task', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).toContain('FROM tasks k');
    expect(sql()).toContain('k.status = 1');
  });

  /** Excluding status 0 instead would drop the OPEN ones and keep the closed. */
  it('excludes DONE (1), not OPEN (0)', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).not.toContain('k.status = 0');
  });

  /**
   * Tasks the panel creates must be born OPEN.
   *
   * This inserted status 1 — DONE — so every task created from the add-on was
   * resolved on arrival and never reached anyone's open list.
   */
  it('creates tasks as OPEN', async () => {
    const { db, sql } = recordingDb();
    await new AccountContextService(db).createTaskForViewer(
      TENANT, 'cust-1', 'Follow up', { userId: 'u1', isAdmin: true },
    );
    const insert = sql().split('\n').find((q) => q.includes('INSERT INTO tasks')) ?? '';
    expect(insert).not.toMatch(/\$\{title\},\s*1,/);
  });
});

/**
 * "Slowest" must be ordered by the median, not by whatever column 3 is.
 *
 * The query used ORDER BY 3 DESC. Adding user_id as column 2 for the deep link
 * shifted column 3 from the median to the thread count, so the section ranked
 * by VOLUME and led with a person at 0.7x the firm — faster than average, at
 * the top of a list of the slowest. Positional ordering breaks silently.
 */
describe('slow responders ordering', () => {
  it('orders by the median column by name', async () => {
    const { db, sql } = recordingDb();
    await new SlowRespondersService(db).get(TENANT, 90);
    expect(sql()).toContain('ORDER BY median_h DESC');
    expect(sql()).not.toContain('ORDER BY 3 DESC');
  });
});

/**
 * Nobody faster than the firm may be named as slow.
 *
 * The query had no floor — it took the top N by median, so whoever sat at the
 * top appeared under "Slowest to answer angry mail" however fast they were.
 * Piyush Garg answers angry clients in 54 minutes, a tenth of the firm median,
 * and was named in a list whose whole force is that the people on it are
 * failing. A section that names individuals has to earn the right to name each
 * of them.
 */
describe('slow responders floor', () => {
  it('requires a median worse than the firm median', async () => {
    const { db, sql } = recordingDb();
    await new SlowRespondersService(db).get(TENANT, 90);
    const q = sql();
    // The HAVING compares the person's median against a firm-wide subquery.
    expect(q).toContain('HAVING');
    expect(q).toContain('FROM emails e2');
  });
});

/**
 * The headline number and the rows beneath it must count the same population.
 *
 * DangerPulse counted every negative thread in the tenant while the fires list
 * counted a filtered subset, so the card's biggest number and the rows under it
 * were measuring different things — a reader comparing them would draw a wrong
 * conclusion from an internally inconsistent card.
 */
describe('population consistency', () => {
  it('DangerPulseService applies the same client filters as the sections', async () => {
    const { db, sql } = recordingDb();
    await new DangerPulseService(db).get(TENANT, 90);
    const q = sql();
    expect(q).toContain('is_auto_created');
    expect(q).toContain("me.direction IN ('to', 'cc')");
  });

  it('SlowRespondersService counts only mail addressed to us', async () => {
    const { db, sql } = recordingDb();
    await new SlowRespondersService(db).get(TENANT, 90);
    expect(sql()).toContain("me.direction IN ('to', 'cc')");
  });
});

/**
 * Per-email aggregates must not join a per-participant table.
 *
 * Adding a JOIN on email_participants to narrow DangerPulse to real clients
 * multiplied the row instead: an email with four customer-linked participants
 * counted four times, taking the headline from 501 replies to 2,089 and the
 * ">5 days" count from 56 to 227. A number that GREW from a change meant only
 * to narrow it is the signature of fan-out.
 */
describe('DangerPulse row multiplication', () => {
  it('tests customers with EXISTS rather than joining participants', async () => {
    const { db, sql } = recordingDb();
    await new DangerPulseService(db).get(TENANT, 90);
    const q = sql();
    expect(q).toContain('FROM email_participants pc');
    // A bare join on the participant table would fan the aggregate out.
    expect(q).not.toMatch(/JOIN email_participants p ON p\.email_id = e\.id/);
  });
});

/**
 * A client is a fire because of what they WROTE, not what they received.
 *
 * FiresService joined email_participants and took whichever row carried a
 * customer_id, which credits a client for mail merely addressed to them. RN
 * Chidakashi was reported as a fire because a collections agency wrote TO them
 * — from william.oxner@abc-amega.com to four @miko.ai addresses. Of 1,484
 * participant rows behind the population, only 275 had the customer as sender.
 *
 * The participant link was also frequently wrong: complaints from
 * mike@plantprovisions.com and jayanth@datairis.io carried a customer_id
 * pointing at our own company, so the own-domain exclusion deleted them.
 * Attributing by the sender's domain resolves 446 of 451 correctly.
 */
describe('fires are attributed to the sender', () => {
  it('joins customer_domains on the from address, not participants', async () => {
    const { db, sql } = recordingDb();
    await new FiresService(db).get(TENANT, { userId: 'u1', isAdmin: true }, 90);
    const q = sql();
    expect(q).toContain('customer_domains cd');
    expect(q).toContain("split_part(lower(e.from_email), '@', 2)");
  });

  /**
   * is_auto_created records how a customer ROW was made, not whether the company
   * is real. For most clients the auto-created record is the only one carrying
   * their domain — excluding it dropped WareIQ Logistics and its 15 unanswered
   * threads.
   */
  it('does not exclude auto-created customers from the fires list', async () => {
    const { db, sql } = recordingDb();
    await new FiresService(db).get(TENANT, { userId: 'u1', isAdmin: true }, 90);
    const cte = sql().split('SELECT DISTINCT ON (e.thread_id)')[1] ?? '';
    expect(cte.split('GROUP BY')[0]).not.toContain('is_auto_created');
  });
});
