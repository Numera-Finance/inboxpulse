import { inject, injectable } from 'tsyringe';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@crm/database';

/**
 * Account context for a sender's domain — the part of the panel Gemini cannot
 * produce.
 *
 * Everything else the add-on shows (summary, sentiment, commitments) is derived
 * from the open thread, which is exactly what Gmail's own summariser already
 * reads. The only genuinely differentiated signal is HISTORY: how long this
 * customer has been writing to us, what they have complained about before, and
 * what is still open. That lives in the database and nowhere else.
 *
 * Keyed by domain rather than customer id so the add-on can resolve a thread it
 * has never seen: the external participant's address is always available from
 * the message headers, with no ingestion required.
 *
 * ACCESS CONTROL — this endpoint returns history the caller may never have seen,
 * including complaints from threads they were not party to. Resolving by domain
 * makes that especially easy to leak: anyone who receives one email from a
 * company could otherwise read that company's entire escalation history.
 *
 * So it is scoped to the VIEWER, not just the tenant, using the same rule the
 * rest of the API applies — admins see everything in their tenant, everyone else
 * sees only customers in user_accessible_customers. A customer the viewer cannot
 * access returns found:false, identical to an unknown domain, so the response
 * does not disclose that the customer exists.
 */

export interface PriorConcern {
  when: string;
  reason: string;
}

export interface AccountContext {
  found: boolean;
  /**
   * 'tenant' — everything the organisation has with this customer, shown only
   * to a viewer entitled to that customer.
   * 'viewer' — only mail the viewer is personally on. Their own correspondence,
   * so it needs no customer assignment.
   */
  scope?: 'tenant' | 'viewer';
  customerId?: string;
  name?: string;
  /** Total messages exchanged with this customer, across every mailbox. */
  messages: number;
  threads: number;
  contacts: number;
  firstSeen?: string;
  lastSeen?: string;
  openTasks: number;
  negativeCount: number;
  /** Most recent negative readings — the "they have raised this before" signal. */
  priorConcerns: PriorConcern[];
}

const EMPTY: AccountContext = {
  found: false,
  messages: 0,
  threads: 0,
  contacts: 0,
  openTasks: 0,
  negativeCount: 0,
  priorConcerns: [],
};

@injectable()
export class AccountContextService {
  constructor(@inject('Database') private readonly db: Database) {}

  async byDomain(
    tenantId: string,
    domain: string,
    viewer: { userId: string; isAdmin: boolean; email?: string },
  ): Promise<AccountContext> {
    const clean = domain.trim().toLowerCase();
    if (!clean.includes('.')) return EMPTY;

    const rows = await this.db.execute(sql`
      SELECT c.id, c.name
      FROM customer_domains cd
      JOIN customers c ON c.id = cd.customer_id
      WHERE cd.tenant_id = ${tenantId} AND lower(cd.domain) = ${clean}
        -- Opening any Gmail thread showed WareIQ Logistics' history, because
        -- they claim gmail.com in customer_domains.
        ${ownableDomain()}
      LIMIT 1
    `);
    const customer = (rows as unknown as Array<{ id: string; name: string }>)[0];
    if (!customer) return EMPTY;

    // Two scopes, and which one applies is decided here rather than by the caller.
    //
    // A viewer entitled to this customer sees everything the organisation has.
    // A viewer who is not still sees THEIR OWN correspondence with the company —
    // mail they were personally on is theirs to read, and refusing it would hide
    // a user's own inbox from them. What it must never do is widen that into the
    // organisation's history, which is the leak.
    const entitled =
      viewer.isAdmin ||
      (await this.hasCustomerAccess(viewer.userId, customer.id));

    const viewerEmail = viewer.email?.trim().toLowerCase();
    if (!entitled && !viewerEmail) return EMPTY;

    const mine = entitled
      ? sql``
      : sql`AND EXISTS (
              SELECT 1 FROM email_participants me
              WHERE me.email_id = e.id AND lower(me.email) = ${viewerEmail}
            )`;

    const [stats, tasks, concerns] = await Promise.all([
      this.stats(tenantId, customer.id, mine),
      entitled ? this.openTasks(tenantId, customer.id) : Promise.resolve(0),
      this.priorConcerns(tenantId, customer.id, mine),
    ]);

    // Nothing of the viewer's own with this company is not worth a section.
    if (!entitled && stats.messages === 0) return EMPTY;

    return {
      found: true,
      scope: entitled ? 'tenant' : 'viewer',
      customerId: customer.id,
      name: customer.name,
      ...stats,
      openTasks: tasks,
      negativeCount: concerns.total,
      priorConcerns: concerns.recent,
    };
  }

  /**
   * Create a task against a customer, assigned to the creator.
   *
   * Refuses when the caller is not entitled to that customer — a write path must
   * enforce the same rule as the read path, or the panel becomes a way to place
   * records into accounts the viewer cannot see.
   */
  async createTaskForViewer(
    tenantId: string,
    customerId: string,
    title: string,
    viewer: { userId: string; isAdmin: boolean },
  ): Promise<{ created: boolean; taskId?: string }> {
    const entitled = viewer.isAdmin || (await this.hasCustomerAccess(viewer.userId, customerId));
    if (!entitled) return { created: false };

    const rows = await this.db.execute(sql`
      -- status 0 = OPEN. It was 1, which is DONE (apps/api/src/tasks/schema.ts:
      -- TaskStatus = { OPEN: 0, DONE: 1 }), so every task the panel created was
      -- born already resolved and never appeared in anyone's open list.
      INSERT INTO tasks (id, tenant_id, customer_id, title, status, assigned_to_id, created_by_system)
      VALUES (gen_random_uuid(), ${tenantId}, ${customerId}, ${title}, 0, ${viewer.userId}, false)
      RETURNING id
    `);
    const id = (rows as unknown as Array<{ id: string }>)[0]?.id;
    return { created: Boolean(id), taskId: id };
  }

  private async hasCustomerAccess(userId: string, customerId: string): Promise<boolean> {
    const rows = await this.db.execute(sql`
      SELECT 1 FROM user_accessible_customers
      WHERE user_id = ${userId} AND customer_id = ${customerId} LIMIT 1
    `);
    return (rows as unknown as unknown[]).length > 0;
  }

  /**
   * Resolve a Gmail address to the InboxPulse user behind it.
   *
   * The add-on knows the viewer's email from Google's signed token but nothing
   * about their role, and hardcoding a role client-side is how an access check
   * becomes decorative. Admin status is decided here, from the user's actual
   * permissions.
   */
  async resolveViewer(
    tenantId: string,
    email: string,
  ): Promise<{ found: boolean; userId?: string; isAdmin: boolean; accessibleCustomers: number }> {
    const rows = await this.db.execute(sql`
      SELECT u.id, r.permissions
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = ${tenantId} AND lower(u.email) = ${email.trim().toLowerCase()}
      LIMIT 1
    `);
    const u = (rows as unknown as Array<{ id: string; permissions: number[] | null }>)[0];
    if (!u) return { found: false, isAdmin: false, accessibleCustomers: 0 };

    // Permission 1 is ADMIN in packages/shared/src/types/rbac.ts.
    const isAdmin = Array.isArray(u.permissions) && u.permissions.includes(1);

    const countRows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS n FROM user_accessible_customers WHERE user_id = ${u.id}
    `);

    return {
      found: true,
      userId: u.id,
      isAdmin,
      accessibleCustomers: Number((countRows as unknown as Array<{ n: number }>)[0]?.n ?? 0),
    };
  }

  private async stats(tenantId: string, customerId: string, mine: ReturnType<typeof sql>) {
    const rows = await this.db.execute(sql`
      SELECT
        COUNT(DISTINCT e.id)::int AS messages,
        COUNT(DISTINCT e.thread_id)::int AS threads,
        MIN(e.received_at)::date::text AS first_seen,
        MAX(e.received_at)::date::text AS last_seen
      FROM email_participants p
      JOIN emails e ON e.id = p.email_id
      WHERE p.tenant_id = ${tenantId} AND p.customer_id = ${customerId}
      ${mine}
    `);
    const r = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {};

    const contactRows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS n FROM contacts
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}
    `);

    return {
      messages: Number(r.messages ?? 0),
      threads: Number(r.threads ?? 0),
      firstSeen: (r.first_seen as string | null) ?? undefined,
      lastSeen: (r.last_seen as string | null) ?? undefined,
      contacts: Number((contactRows as unknown as Array<{ n: number }>)[0]?.n ?? 0),
    };
  }

  /**
   * Open tasks.
   *
   * tasks.status is TaskStatus in apps/api/src/tasks/schema.ts: OPEN=0, DONE=1.
   * There is no status 2. This filtered `status <> 2`, which matches both values
   * and counted every task ever created as open -- 1004 rows against 185 truly
   * open on the clone, a 5.4x overstatement rendered as a flat number with no
   * hint it was wrong.
   *
   * Cross-checked against the data rather than the enum name alone: all 819
   * status=1 rows carry completed_at and a resolution, and no status=0 row does.
   */
  private async openTasks(tenantId: string, customerId: string): Promise<number> {
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS n FROM tasks
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND status = 0
    `);
    return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  }

  /**
   * Past negative readings, deduplicated by reason. The same complaint often
   * appears once per message in a thread, and three identical rows read as three
   * separate problems when they are one.
   */
  private async priorConcerns(tenantId: string, customerId: string, mine: ReturnType<typeof sql>) {
    const rows = await this.db.execute(sql`
      SELECT e.received_at::date::text AS when, a.reasoning
      FROM email_analyses a
      JOIN emails e ON e.id = a.email_id
      JOIN email_participants p ON p.email_id = e.id
      WHERE a.tenant_id = ${tenantId}
        AND p.customer_id = ${customerId}
        AND a.analysis_type = 'sentiment'
        AND a.sentiment_value = 'negative'
        ${mine}
      ORDER BY e.received_at DESC
      LIMIT 40
    `);

    const all = rows as unknown as Array<{ when: string; reasoning: string | null }>;
    const seen = new Set<string>();
    const recent: PriorConcern[] = [];
    for (const r of all) {
      const reason = (r.reasoning ?? '').trim();
      if (!reason) continue;
      const key = reason.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recent.push({ when: r.when, reason: reason.slice(0, 160) });
      if (recent.length === 3) break;
    }
    return { total: all.length, recent };
  }
}

export interface WaitingClient {
  customerId: string | null;
  customer: string;
  subject: string;
  from: string;
  daysWaiting: number;
  reason: string;
}

/**
 * Angry clients nobody has answered.
 *
 * The team-lead question, asked directly: *is there an angry client that is not
 * being answered to?* Every dashboard in this codebase answers a version of it
 * indirectly — sentiment distributions, escalation counts, turnaround charts —
 * and a lead reading those still has to do the join in their head.
 *
 * Three conditions, all necessary:
 *   negative sentiment  — they are unhappy
 *   first_reply_at NULL — nobody has replied
 *   inbound             — it is their message, not ours
 *
 * DISTINCT ON the thread, because a naive join returns one row per message and
 * per participant: the same complaint appeared six times in the first draft of
 * this query, which would have made one unhappy client look like a crisis.
 *
 * Own-domain customers are excluded. `email_participants` links internal
 * senders to a customer record for our own company, so without this the list is
 * topped by "Mystartupcfo" being unhappy with itself.
 */
/**
 * The thread must have somebody from THIS FIRM on it.
 *
 * Not a refinement — without it these services answer a different question than
 * the one the card asks, and answer it against our own staff.
 *
 * We watch OUR OWN mailboxes, not the client's. In practice that is
 * `emailsentiment@mystartupcfo.com` (128,050 messages; `npradhan@` has 16), and
 * it is a member of the per-client group ids the firm creates so a whole team
 * can listen on one client — `callrevu@mystartupcfo.com` and the like. Mail a
 * client sends to one of those groups therefore arrives carrying OUR address in
 * `To:`. That is the intended corpus, and it is the half that this predicate
 * keeps.
 *
 * The other half arrives a different way. Clients also auto-forward their own
 * mail into the address we gave them so their bookkeeper sees the traffic, and
 * a forwarded message KEEPS ITS ORIGINAL `To:` — no address of ours appears on
 * it anywhere. Some clients forward selectively; some forward the lot. One
 * pool-service client contributed 925 threads of which 786 name nobody of ours:
 * homeowners writing about pool routes, Facebook lead alerts, QuickBooks
 * receipts. Real business mail, correctly ingested, and never addressed to us.
 *
 * So the two cases are distinguishable by exactly one thing — whether anyone of
 * ours is on the thread — and that is the whole of this predicate.
 *
 * "Unanswered angry client" over that corpus scores the CLIENT's own customer
 * service and books the result against the account manager who was never on the
 * thread. It moved the 90-day count from 380 to 297.
 *
 * `participant_type = 'user'` is the test: a participant resolved to a row in
 * `users`. It agrees with a domain-matching check almost exactly (Cognition IP
 * 25/25, MerQube 138/138, Blitzz 53/53) while staying on an index instead of
 * unpacking the address JSON per row — 83ms on the waiting-clients shape.
 *
 * Checked across the THREAD, not the message. The flagged message is inbound
 * from the client by construction, so a message-level test would exclude every
 * thread it is supposed to keep.
 *
 * SAFE AGAINST GROUP INBOXES, which is the failure that would matter most: a
 * group id is where a client's real mail lands, so dropping those would empty
 * the sections of exactly the threads they exist for. Group ids are registered
 * as `users` rows — `callrevu@mystartupcfo.com` is one — so they satisfy the
 * predicate like any staff address. Verified on the case rather than argued
 * from the schema: all 43 callrevu threads are kept, and no `@mystartupcfo.com`
 * recipient anywhere in the corpus lacks a `users` row.
 *
 * That is the assumption to re-check first if a section goes quiet. If group
 * addresses are ever created OUTSIDE `users` — a bare Google Group with no
 * corresponding row — this predicate starts hiding real client threads, and it
 * will do so silently, because the section renders empty rather than wrong.
 */
function weAreOnTheThread(): SQL {
  return sql`
    AND EXISTS (
      SELECT 1 FROM emails e2
      JOIN email_participants pp
        ON pp.email_id = e2.id AND pp.participant_type = 'user'
      WHERE e2.thread_id = e.thread_id AND e2.tenant_id = e.tenant_id
    )
  `;
}

/**
 * Customers that are not clients, and so have no place in a client review.
 *
 * The own-domain rule catches our own entities by counting staff accounts on a
 * domain, which works for `mystartupcfo.com` and misses everything else. Three
 * kinds slip through: vendors we buy from (SVB, Rippling, Bill), our own
 * entities too small to trip the staff threshold, and — the one that is
 * genuinely undetectable — outsourced firms doing OUR delivery work.
 * `chitrabatchuca.com` is a CA practice in India working for MyTaxFiler, five
 * people sending from it, and from the mail alone it is indistinguishable from
 * a client. Grid role-holders are 100% `mystartupcfo.com`, so the allocation
 * sheet cannot identify it either. Nothing in the data can.
 *
 * Which is why it is a TABLE rather than a list in this file. This knowledge
 * was once a constant, `blueoceanps` went into it on the assumption that it was
 * our own domain, and Blue Ocean Pool Service — a real customer — was silently
 * dropped from the review with 45 threads. A row can be read and corrected by
 * whoever owns the client list; a constant can only be found by whoever reads
 * this file.
 *
 * Absence means client. A customer added tomorrow is treated as a client by
 * default, which is the safe direction: a missing row shows up as a vendor in a
 * review, which someone notices, rather than a client vanishing from it, which
 * nobody does.
 */
/**
 * Whether the non-client table exists, asked once per process.
 *
 * The table arrives by migration and migrations are applied by hand — there is
 * no startup migrator — so a deploy can reach production before the SQL does. A
 * first attempt did exactly that and turned every management section into a
 * 500.
 *
 * The check CANNOT be expressed in the query itself. `to_regclass(...) IS NOT
 * NULL` inside the WHERE looks like it should guard the reference, but Postgres
 * resolves relations while parsing, long before any condition is evaluated, so
 * the statement fails to parse whatever the guard says. It has to be a separate
 * round trip whose result decides which SQL is built.
 *
 * Cached because the answer changes at most once in a process's life, and this
 * sits in a path a human is waiting on.
 */
let relationshipsTable: boolean | null = null;

/**
 * Clear the cached answer. Tests only.
 *
 * Exported because the degraded path — no table, no exclusion — is the whole
 * reason the check exists, and a process-lifetime cache cannot otherwise be
 * exercised twice in one suite. Nothing in the service path calls it.
 */
export function __resetRelationshipsTableCache(): void {
  relationshipsTable = null;
}

async function hasRelationshipsTable(db: Database): Promise<boolean> {
  // ONLY A POSITIVE RESULT IS CACHED.
  //
  // A table can appear during a process's life — it arrives by hand-applied
  // migration — but it never disappears. Caching `false` therefore pins an
  // instance to the degraded path forever, and that is not hypothetical: the
  // migration was applied while crm-api was serving, and every warm instance
  // went on excluding nobody. The partner firm seeded seconds earlier still
  // ranked in the fires list, which looks exactly like the seed silently
  // failing.
  //
  // So a miss re-probes on the next call. That is one catalogue lookup on a
  // path that already runs several queries, and it stops being paid the moment
  // the table exists.
  if (relationshipsTable === true) return true;
  try {
    const rows = await db.execute(
      sql`SELECT to_regclass('public.customer_relationships') IS NOT NULL AS ok`,
    );
    const ok = Boolean((rows as unknown as Array<{ ok: boolean }>)[0]?.ok);
    if (ok) relationshipsTable = true;
    return ok;
  } catch {
    // An unreadable catalogue is treated as absent: degrading is safe, and
    // failing a whole section over a probe would defeat the point.
    return false;
  }
}

/**
 * Customers that are not clients, and so have no place in a client review.
 *
 * The own-domain rule catches our own entities by counting staff accounts on a
 * domain, which works for `mystartupcfo.com` and misses everything else. Three
 * kinds slip through: vendors we buy from (SVB, Rippling, Bill), our own
 * entities too small to trip the staff threshold, and — the one that is
 * genuinely undetectable — outsourced firms doing OUR delivery work.
 * `chitrabatchuca.com` is a CA practice in India working for MyTaxFiler, five
 * people sending from it, and from the mail alone it is indistinguishable from
 * a client. Grid role-holders are 100% `mystartupcfo.com`, so the allocation
 * sheet cannot identify it either. Nothing in the data can.
 *
 * Which is why it is a TABLE rather than a list in this file. This knowledge
 * was once a constant, `blueoceanps` went into it on the assumption that it was
 * our own domain, and Blue Ocean Pool Service — a real customer — was silently
 * dropped from the review with 45 threads. A row can be read and corrected by
 * whoever owns the client list; a constant can only be found by whoever reads
 * this file.
 *
 * Absence means client, at both levels. A customer with no row is a client, and
 * a database with no TABLE excludes nobody — identical to the table being
 * empty, which is the state it starts in. A partner firm reappearing in the
 * review is visible; a client vanishing from it is not.
 */
function isAClient(tenantId: string, tableExists: boolean): SQL {
  if (!tableExists) return sql``;
  return sql`
    AND NOT EXISTS (
      SELECT 1 FROM customer_relationships cr
      WHERE cr.customer_id = c.id AND cr.tenant_id = ${tenantId}
    )
  `;
}

/**
 * The angry message must have been ADDRESSED TO US.
 *
 * weAreOnTheThread asks whether anyone from the firm appears anywhere on the
 * thread, which is the right test for "is this our conversation at all". It is
 * too loose for "did we fail to reply", because a thread can contain us on one
 * message and be a conversation between other parties on the next.
 *
 * The case that exposed it: a client wrote to their own payroll provider —
 * elle@thesis.inc to support@justworks.com, "Assistance with Third-Party Admin
 * Access and Invoicing" — on a thread we are on elsewhere. Negative, no reply
 * from us, and correctly so: nobody asked us anything. It ranked as an angry
 * client we had ignored.
 *
 * So the flagged message itself must carry a staff recipient. Recipient, not
 * sender: the message is inbound from the client by construction, so testing
 * for a staff SENDER would exclude every row the section exists to show.
 *
 * Cheap in practice — 296 threads to 294 on production. It removes a specific
 * false accusation rather than trimming the population.
 */
function weWereAddressed(): SQL {
  return sql`
    AND EXISTS (
      SELECT 1 FROM email_participants me
      WHERE me.email_id = e.id
        AND me.participant_type = 'user'
        AND me.direction IN ('to', 'cc')
    )
  `;
}

/**
 * A thread somebody already closed is not unanswered.
 *
 * "Unanswered" was `first_reply_at IS NULL` alone, and that column is only as
 * good as the reply matcher — replies are matched for a timestamp and then
 * discarded, so it is null far more often than a client is actually waiting.
 * The human signal is more reliable and was being ignored: someone opened the
 * escalation, dealt with it, and marked the task DONE.
 *
 * The gap is not a rounding error. Truefoundry showed 7 unanswered while the
 * web view showed 4 of 6 resolved; tenant-wide the count falls from 379 to 83.
 * Four fifths of what the panel called an unanswered angry client had already
 * been handled, which is the difference between a section a manager acts on and
 * one they learn to ignore.
 *
 * TaskStatus.DONE is 1 and OPEN is 0 (apps/api/src/tasks/schema.ts) — worth
 * stating because the enum reads backwards to most people, and getting it the
 * wrong way round silently inverts the whole metric.
 */
function notAlreadyResolved(): SQL {
  return sql`
    AND NOT EXISTS (
      SELECT 1 FROM tasks k
      WHERE k.email_id = e.id AND k.status = 1
    )
  `;
}

/**
 * Domains no customer can own, however the database is configured.
 *
 * Five customers claim a free-mail domain in `customer_domains`: WareIQ
 * Logistics owns `gmail.com`, OkTech owns `yahoo.com`, Foxlee `aol.com`,
 * Travelart `hotmail.com`, Little Learners Lab `outlook.com`. Attribution by
 * sender domain is the right rule — it fixed a worse mis-attribution — but with
 * those rows present it credits WareIQ with every Gmail sender in the corpus:
 * 589 distinct addresses. They arrived at the top of the fires list with "15
 * unhappy, 8 unanswered", nearly all of it strangers.
 *
 * The same lookup backs account history, so opening any Gmail thread showed
 * WareIQ's record.
 *
 * A list rather than a derived rule, and the distinction from the `blueoceanps`
 * hardcoding mistake matters: that was a claim about which COMPANIES are ours,
 * which is local knowledge that changes and belongs in data. This is the set of
 * public mailbox providers, which is stable, universal, and true regardless of
 * tenant. A derived signal was tried first — sender count per domain — and does
 * not separate: gmail.com has 589 senders, but mystartupcfo.com has 276 and
 * truefoundry.com 47, so any threshold either keeps gmail or discards real
 * clients.
 *
 * The rows themselves should still be deleted from `customer_domains`; this
 * guard means a stale row cannot silently poison a metric in the meantime.
 */
const PUBLIC_MAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me',
  'gmx.com', 'gmx.net', 'yandex.com', 'zoho.com', 'mail.com', 'rediffmail.com',
];

/** The sender's domain must be one a company can actually own. */
function ownableDomain(): SQL {
  return sql`AND lower(cd.domain) <> ALL(ARRAY[${sql.join(
    PUBLIC_MAIL_DOMAINS.map((d) => sql`${d}`),
    sql`, `,
  )}]::text[])`;
}

export interface WaitingOptions {
  days: number;
  limit: number;
  /** Domains that are US, not a client. */
  ownDomains: string[];
}

@injectable()
export class WaitingClientsService {
  constructor(@inject('Database') private readonly db: Database) {}

  async find(
    tenantId: string,
    viewer: { userId: string; isAdmin: boolean },
    opts: WaitingOptions,
  ): Promise<WaitingClient[]> {
    // Same entitlement rule as everything else: admins see the tenant, everyone
    // else sees only customers they are assigned. A lead's view of "who is
    // angry" must not become a way to read accounts they cannot otherwise open.
    const scope = viewer.isAdmin
      ? sql``
      : sql`AND p.customer_id IN (
              SELECT customer_id FROM user_accessible_customers WHERE user_id = ${viewer.userId}
            )`;

    const clientFilter = isAClient(tenantId, await hasRelationshipsTable(this.db));

    // ARRAY[...]::text[], built one parameter at a time.
    //
    // This read `<> ALL(${arrayOfStrings})`, and drizzle renders a bare JS array
    // as a parenthesised list — `ALL(($3, $4))` — which Postgres parses as a ROW
    // CONSTRUCTOR, not an array:
    //
    //   ERROR: op ANY/ALL (array) requires array on right side
    //
    // So the whole statement failed, and `/api/internal/addon/waiting` returned
    // 500 for every request. In the panel that is invisible: the client fetch
    // swallows a non-OK response, returns [], and the section simply does not
    // render — which reads as "no angry clients waiting", the most reassuring
    // possible result. It had been doing that in production, and the only
    // reason it surfaced was going looking for a different bug.
    //
    // Anything that turns a failure into good news deserves the ugly explicit
    // form. sql.join emits ARRAY[$3, $4] with each value still parameterised.
    const own = opts.ownDomains.length
      ? sql`AND lower(c.name) <> ALL(ARRAY[${sql.join(
          opts.ownDomains.map((d) => sql`${d.split('.')[0].toLowerCase()}`),
          sql`, `,
        )}]::text[])`
      : sql``;

    // The qualifying set is built FIRST, and materialised on purpose.
    //
    // This query timed out in production — Cloud Run killed the request at its
    // limit — while running in 92ms against a clone with the same shape. The
    // difference is not the SQL, it is where the matching rows happen to fall.
    //
    // The filter is extremely sparse: 448 qualifying rows out of 113,049 emails
    // in the window, 0.4%. Left to itself the planner satisfies
    // `DISTINCT ON (thread_id) ... LIMIT 6` by walking the thread_id index and
    // stopping once six distinct threads qualify. On the clone it found them
    // after 448 rows and looked fast. That cost is pure luck: it is a function
    // of how far into thread_id order the sixth match sits, and nothing bounds
    // it. On a larger mailbox the same plan scans until it runs out of time.
    //
    // AS MATERIALIZED forces the sparse set to be computed once — a few hundred
    // rows — before any ordering or limiting. Postgres 12+ inlines CTEs by
    // default, so the keyword is doing real work here and removing it restores
    // the unbounded plan.
    //
    // The participant and customer joins stay OUTSIDE, because the entitlement
    // scope and the client filters are expressed against `p` and `c` and must
    // apply after the set exists.
    const rows = await this.db.execute(sql`
      WITH q AS MATERIALIZED (
        SELECT e.id, e.thread_id, e.subject, e.received_at,
               e.from_name, e.from_email, a.reasoning
        FROM emails e
        JOIN email_analyses a
          ON a.email_id = e.id AND a.analysis_type = 'sentiment' AND a.sentiment_value = 'negative'
        WHERE e.tenant_id = ${tenantId}
          AND e.first_reply_at IS NULL
          AND e.is_customer_email
          AND e.received_at > now() - (${opts.days} || ' days')::interval
          ${weAreOnTheThread()}
          ${weWereAddressed()}
          ${notAlreadyResolved()}
      )
      SELECT DISTINCT ON (q.thread_id)
        c.id::text            AS customer_id,
        COALESCE(c.name, '(unknown)') AS customer,
        q.subject,
        COALESCE(q.from_name, q.from_email) AS from_who,
        GREATEST(0, EXTRACT(EPOCH FROM (now() - q.received_at)) / 86400)::int AS days_waiting,
        COALESCE(q.reasoning, '') AS reason
      FROM q
      LEFT JOIN email_participants p ON p.email_id = q.id AND p.customer_id IS NOT NULL
      LEFT JOIN customers c ON c.id = p.customer_id
      WHERE TRUE
        -- The same three exclusions the other management services apply.
        --
        -- This section had only the own-domain name list and the client filter,
        -- which made it the odd one out: it listed customers the INGESTER
        -- INVENTED from a sender domain. Justworks (Auto) is a payroll provider
        -- -- our vendor, never our client -- and it appeared as an angry client
        -- nobody had answered. Clicking through found nothing, because there
        -- was nothing: the row was an artefact of weaker filtering.
        --
        -- Own entities go too. The name-based list covers mystartupcfo
        -- and numerafinance but not mytaxfiler, so "Mytaxfiler" ranked as a
        -- client unhappy with us. The staff-domain rule below is derived from
        -- the users table and catches every domain the firm actually staffs,
        -- which is why the other services use it instead of a list.
        AND NOT c.is_auto_created
        AND NOT EXISTS (
          SELECT 1 FROM customer_domains cd
          WHERE cd.customer_id = c.id
            AND lower(cd.domain) IN (
              SELECT split_part(lower(u2.email), '@', 2)
              FROM users u2
              WHERE u2.tenant_id = ${tenantId} AND u2.email LIKE '%@%'
              GROUP BY 1
              HAVING count(*) >= ${OWN_DOMAIN_MIN_STAFF}
            )
        )
        ${own}
        ${clientFilter}
        ${scope}
      ORDER BY q.thread_id, q.received_at DESC
      LIMIT ${opts.limit}
    `);

    return (rows as unknown as Array<Record<string, unknown>>)
      .map((r) => ({
        customerId: (r.customer_id as string | null) ?? null,
        customer: String(r.customer ?? '(unknown)'),
        subject: String(r.subject ?? '(no subject)'),
        from: String(r.from_who ?? ''),
        daysWaiting: Number(r.days_waiting ?? 0),
        reason: String(r.reason ?? '').slice(0, 140),
      }))
      // Longest wait first: the one that has been ignored longest is the one
      // most likely to have been forgotten, which is the whole question.
      .sort((a, b) => b.daysWaiting - a.daysWaiting);
  }
}

export interface DangerPulse {
  /** Median hours to first reply on NEGATIVE inbound, last 90 days. */
  negativeMedianH: number | null;
  /** Same for everything else — the comparison is the whole point. */
  otherMedianH: number | null;
  /** The tail: 10% of angry clients wait at least this long. */
  negativeP90H: number | null;
  negativeCount: number;
  /**
   * Angry clients who waited MORE THAN FIVE DAYS for a first reply.
   *
   * The number this product exists to move, and it is deliberately a COUNT of
   * people rather than a duration. Measured on production: the median is 12.9h
   * against 15.1h for routine mail — half of unhappy clients hear back the same
   * working day, so the median is already acceptable and optimising it changes
   * nothing anyone would notice.
   *
   * The damage is entirely in the tail. 56 of 505 answered negative threads
   * waited over five days, and those are the ones that leave. A median can
   * drift two hours and mean nothing; moving 56 to 20 is a business outcome.
   *
   * Five days rather than p90 because a percentile moves when the population
   * changes and cannot be acted on — nobody can picture "the 90th percentile".
   * "Fifty-six clients waited more than five days" is a number a lead can carry
   * into a meeting and check again next month.
   */
  overFiveDays: number;
  /** Median per month, oldest first, for a text sparkline. */
  trend: Array<{ month: string; medianH: number }>;
  /** Share of replies attributable to a person — caveats the per-person view. */
  attributionPct: number;
}

/**
 * The number InboxPulse exists to move.
 *
 * The product is a management tool for sensing where the danger is, and the
 * danger is an unhappy client waiting. So the headline is **median time to
 * first reply on negative mail** — and it is reported ALONGSIDE the same figure
 * for everything else, because the number alone is meaningless.
 *
 * On the current data that comparison is the finding: negative 12.9h against
 * other 15.1h. Angry mail is answered barely faster than routine mail, which
 * means sentiment is not currently changing anyone's behaviour. A lead reading
 * "12.9h" alone would conclude things are fine.
 *
 * p90 is reported because the median hides the cases that matter. Half of angry
 * clients hear back inside 13 hours; a tenth wait nearly six days, and those are
 * the ones that leave.
 *
 * Rows where first_reply_at precedes received_at are excluded — the field is
 * populated by a matcher that can mis-associate, and a negative duration would
 * drag a median toward a number nobody can act on.
 */
@injectable()
export class DangerPulseService {
  constructor(@inject('Database') private readonly db: Database) {}

  async get(tenantId: string, days = 90): Promise<DangerPulse> {
    const clientFilter = isAClient(tenantId, await hasRelationshipsTable(this.db));

    // The SAME POPULATION as the sections above it, or the headline lies.
    //
    // This counted every negative thread in the tenant while "Where the fires
    // are" counted a filtered subset, so the card's biggest number and the rows
    // under it were measuring different things. Three filters were missing:
    //
    //   weWereAddressed  — a client writing to their own payroll provider on a
    //                      thread we appear on elsewhere is not mail we were
    //                      asked to answer, and its duration is not our reply
    //                      time.
    //   is_auto_created  — customers the ingester invented from a sender domain.
    //   clientFilter     — vendors and delivery partners.
    //
    // notAlreadyResolved is deliberately absent: this population requires
    // first_reply_at IS NOT NULL, so every row here was answered by definition.
    const base = sql`
      FROM emails e
      JOIN email_analyses a ON a.email_id = e.id AND a.analysis_type = 'sentiment'
      WHERE e.tenant_id = ${tenantId}
        AND e.is_customer_email
        AND e.first_reply_at IS NOT NULL
        AND e.first_reply_at > e.received_at
        AND e.received_at > now() - (${days} || ' days')::interval
        ${weAreOnTheThread()}
        ${weWereAddressed()}
        -- EXISTS, NOT A JOIN.
        --
        -- Joining email_participants multiplies the row: an email with four
        -- customer-linked participants counts four times. Adding that join here
        -- took the headline from 501 replies to 2,089 and the ">5 days" count
        -- from 56 to 227 -- a number that grew because of a change meant only
        -- to narrow it. Every aggregate on this query is per-EMAIL, so the
        -- customer test has to be a predicate, not another row source.
        AND EXISTS (
          SELECT 1 FROM email_participants pc
          JOIN customers c ON c.id = pc.customer_id
          WHERE pc.email_id = e.id
            AND pc.customer_id IS NOT NULL
            AND NOT c.is_auto_created
            AND NOT EXISTS (
              SELECT 1 FROM customer_relationships cr
              WHERE cr.customer_id = c.id AND cr.tenant_id = ${tenantId}
            )
        )
        ${weAreOnTheThread()}
    `;

    const rows = await this.db.execute(sql`
      SELECT
        (a.sentiment_value = 'negative') AS is_neg,
        count(*)::int AS n,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (e.first_reply_at - e.received_at)) / 3600
        ) AS median_h,
        percentile_cont(0.9) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (e.first_reply_at - e.received_at)) / 3600
        ) AS p90_h,
        count(*) FILTER (
          WHERE EXTRACT(EPOCH FROM (e.first_reply_at - e.received_at)) / 3600 > 120
        )::int AS over_five_days
      ${base}
      GROUP BY 1
    `);

    const byNeg = new Map(
      (rows as unknown as Array<Record<string, unknown>>).map((r) => [Boolean(r.is_neg), r]),
    );
    const neg = byNeg.get(true);
    const oth = byNeg.get(false);

    const trendRows = await this.db.execute(sql`
      SELECT to_char(date_trunc('month', e.received_at), 'YYYY-MM') AS month,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (e.first_reply_at - e.received_at)) / 3600
             ) AS median_h
      ${base} AND a.sentiment_value = 'negative'
      GROUP BY 1 ORDER BY 1
    `);

    const attrRows = await this.db.execute(sql`
      SELECT count(*)::int AS n, count(e.first_reply_by_id)::int AS attributed
      ${base} AND a.sentiment_value = 'negative'
    `);
    const attr = (attrRows as unknown as Array<{ n: number; attributed: number }>)[0];

    const num = (v: unknown): number | null =>
      v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;

    return {
      negativeMedianH: num(neg?.median_h),
      otherMedianH: num(oth?.median_h),
      negativeP90H: num(neg?.p90_h),
      negativeCount: Number(neg?.n ?? 0),
      overFiveDays: Number(neg?.over_five_days ?? 0),
      trend: (trendRows as unknown as Array<{ month: string; median_h: unknown }>).map((r) => ({
        month: r.month,
        medianH: Number(num(r.median_h) ?? 0),
      })),
      attributionPct: attr?.n ? Math.round((100 * attr.attributed) / attr.n) : 0,
    };
  }
}

export interface OwnerLoad {
  name: string;
  threads: number;
  oldestDays: number;
  unassigned: boolean;
  /**
   * For the unallocated row only: which customers it is made of.
   *
   * An aggregate count here changes nothing a reader can act on, because the
   * bucket is not one kind of thing. Measured on the live data it is 16 threads
   * across 12 customers, and roughly half of them are our own vendors and
   * counterparties rather than clients — SVB, Rippling, Bill, Countsy, a law
   * firm. The other half are real clients simply missing from the allocation
   * sheet: Truefoundry, Minerra Health, Elemind, Goicon.
   *
   * Those two need opposite responses — one is a customer record that should
   * not be in a client review at all, the other is a client nobody has been
   * assigned to. "16 unallocated" cannot tell them apart, so it prompts
   * nothing. The names can: a reader who sees Truefoundry adds an owner, and a
   * reader who sees SVB knows the list is picking up vendors.
   */
  customers?: Array<{ name: string; threads: number }>;
}

/**
 * Who is carrying the unanswered angry mail, by ROLE.
 *
 * Getting attribution right was most of the work here, and three sources had to
 * be tried before one held up:
 *
 *   first_reply_by_id — 7% populated. Replies are never stored (see
 *     emails/service.ts: matched for a timestamp, then discarded), so there is
 *     usually no row to attribute. A ranking on 7% coverage ranks whoever
 *     happens to be attributable.
 *
 *   user_customers — 100% coverage but FOUR TO FIVE owners per client and
 *     role_id null on all 4,111 mappings. Counting per owner charged one
 *     complaint to five people.
 *
 *   customer_allocations — the firm's own allocation sheet: one person per role
 *     per client, six roles, 857 clients, 181 people. 90% of rows match a
 *     customer by normalised name. THIS is the accountable owner.
 *
 * Own entities and auto-created customers are excluded. Without that the list
 * is topped by "Mystartupcfo" (46 threads) being unhappy with itself, and by
 * customers the ingester invented from a sender domain. Excluding them takes
 * the population from 188 threads to 30 — the 188 was almost entirely noise,
 * and reporting it would have been a management review of our own mail.
 */

/**
 * Customers that are actually US, derived rather than listed.
 *
 * This was a hardcoded array — and it contained 'blueoceanps', which is a real
 * client (Blue Ocean Pool Service, blueoceanps.co). A hand-maintained "not a
 * client" list silently removed a paying customer from the management review,
 * which is the exact opposite of what this feature is for, and nothing would
 * ever have surfaced it: an excluded row simply does not appear.
 *
 * So it is derived from where STAFF have accounts. A domain with three or more
 * users in the `users` table is somewhere we work, not somewhere we sell to.
 * That yields mystartupcfo.com, numerafinance.com and mytaxfiler.com — the
 * three that are genuinely ours — and cannot accidentally capture a client,
 * because clients do not have staff accounts here.
 *
 * The threshold is three rather than one so a single client contact who was
 * given a login cannot hide their own company from the review.
 */
const OWN_DOMAIN_MIN_STAFF = 3;

@injectable()
export class OwnerLoadService {
  constructor(@inject('Database') private readonly db: Database) {}

  async get(
    tenantId: string,
    days = 30,
    role = 'Account manager',
    limit = 8,
  ): Promise<OwnerLoad[]> {
    const clientFilter = isAClient(tenantId, await hasRelationshipsTable(this.db));
    const rows = await this.db.execute(sql`
      WITH t AS MATERIALIZED (
        -- One row per THREAD. Without this a complaint counts once per message
        -- and once per participant.
        SELECT DISTINCT ON (e.thread_id) e.thread_id, e.received_at, p.customer_id
        FROM emails e
        JOIN email_analyses a
          ON a.email_id = e.id AND a.analysis_type = 'sentiment' AND a.sentiment_value = 'negative'
        JOIN email_participants p ON p.email_id = e.id AND p.customer_id IS NOT NULL
        WHERE e.tenant_id = ${tenantId}
          AND e.first_reply_at IS NULL
          AND e.is_customer_email
          AND e.received_at > now() - (${days} || ' days')::interval
          ${weAreOnTheThread()}
        ORDER BY e.thread_id, e.received_at DESC
      )
      SELECT
        COALESCE(u.first_name || ' ' || u.last_name, al.email, '(not allocated)') AS who,
        (al.id IS NULL) AS is_unassigned,
        count(DISTINCT t.thread_id)::int AS threads,
        MAX(EXTRACT(EPOCH FROM (now() - t.received_at)) / 86400)::int AS oldest_days
      FROM t
      JOIN customers c ON c.id = t.customer_id
      LEFT JOIN customer_allocations al
        ON al.customer_id = c.id AND al.tenant_id = ${tenantId} AND al.role = ${role}
      LEFT JOIN users u ON u.id = al.user_id
      WHERE NOT c.is_auto_created
        AND NOT EXISTS (
          SELECT 1 FROM customer_domains cd
          WHERE cd.customer_id = c.id
            AND lower(cd.domain) IN (
              SELECT split_part(lower(u2.email), '@', 2)
              FROM users u2
              WHERE u2.tenant_id = ${tenantId} AND u2.email LIKE '%@%'
              GROUP BY 1
              HAVING count(*) >= ${OWN_DOMAIN_MIN_STAFF}
            )
        )
        ${clientFilter}
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT ${limit}
    `);

    const owners = (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      name: String(r.who),
      threads: Number(r.threads ?? 0),
      oldestDays: Number(r.oldest_days ?? 0),
      unassigned: Boolean(r.is_unassigned),
    }));

    // Nothing more to fetch if every thread has an owner.
    if (!owners.some((o) => o.unassigned)) return owners;

    // The same population, grouped by customer instead of by person. Run as a
    // second query rather than folded into the first: the main one groups by
    // owner, and adding the customer to that GROUP BY would split a real
    // manager's row into one line per account, which is the opposite of what
    // the section is for.
    const nameRows = await this.db.execute(sql`
      WITH t AS MATERIALIZED (
        SELECT DISTINCT ON (e.thread_id) e.thread_id, p.customer_id
        FROM emails e
        JOIN email_analyses a
          ON a.email_id = e.id AND a.analysis_type = 'sentiment' AND a.sentiment_value = 'negative'
        JOIN email_participants p ON p.email_id = e.id AND p.customer_id IS NOT NULL
        WHERE e.tenant_id = ${tenantId}
          AND e.first_reply_at IS NULL
          AND e.is_customer_email
          AND e.received_at > now() - (${days} || ' days')::interval
          ${weAreOnTheThread()}
        ORDER BY e.thread_id, e.received_at DESC
      )
      SELECT COALESCE(c.name, '(unknown)') AS customer,
             count(DISTINCT t.thread_id)::int AS threads
      FROM t
      JOIN customers c ON c.id = t.customer_id
      WHERE NOT c.is_auto_created
        AND NOT EXISTS (
          SELECT 1 FROM customer_domains cd
          WHERE cd.customer_id = c.id
            AND lower(cd.domain) IN (
              SELECT split_part(lower(u2.email), '@', 2)
              FROM users u2
              WHERE u2.tenant_id = ${tenantId} AND u2.email LIKE '%@%'
              GROUP BY 1
              HAVING count(*) >= ${OWN_DOMAIN_MIN_STAFF}
            )
        )
        ${clientFilter}
        AND NOT EXISTS (
          SELECT 1 FROM customer_allocations al
          WHERE al.customer_id = c.id AND al.tenant_id = ${tenantId} AND al.role = ${role}
        )
      GROUP BY 1
      ORDER BY 2 DESC, 1
      LIMIT ${limit}
    `);

    const customers = (nameRows as unknown as Array<Record<string, unknown>>).map((r) => ({
      name: String(r.customer ?? '(unknown)'),
      threads: Number(r.threads ?? 0),
    }));

    return owners.map((o) => (o.unassigned ? { ...o, customers } : o));
  }
}

export interface Fire {
  customerId: string | null;
  customer: string;
  /** Negative threads in the window. */
  negative: number;
  /** How many of those nobody has answered. */
  unanswered: number;
  oldestDays: number;
  /** Who to call, or null when the client is not on the allocation sheet. */
  owner: string | null;
  /**
   * Which role that person holds.
   *
   * Named because the fallback changes who you are being sent to. An Account
   * manager is the default answer; an Accountant or Bookkeeper is the person
   * who does the work when no manager is assigned, and a reader about to make a
   * call needs to know which they are getting.
   */
  ownerRole: string | null;
  /**
   * Complaint rate by month, oldest first, as whole percents.
   *
   * A count alone cannot tell a client who is getting worse from one who has
   * always been difficult, and those need different responses. Measured across
   * 693 client-months: a client under 10% in a month behaves exactly like one at
   * zero — 2.0% complaints the following month either way. A client who crosses
   * 10% runs 7.9% the next month, and is still at 5.9% three months later
   * against 1.6% for clients who never crossed. Occasional friction is noise;
   * crossing 10% is a step change that does not revert.
   *
   * Empty when the client has too little mail per month to compute a rate.
   */
  arc: number[];
}

/**
 * Where the fires are — by CLIENT, not by thread.
 *
 * "Angry and unanswered" lists individual threads, which is the right shape for
 * someone about to reply and the wrong shape for someone deciding where to
 * spend their afternoon. A manager does not want twelve rows that turn out to
 * be four clients; they want to know that Deserve has eighteen unhappy threads
 * and eight of them nobody has touched.
 *
 * ONE ANGRY EMAIL IS NOISE. Measured over 90 days: 135 clients have exactly one
 * negative thread, 40 have two, and 51 have three or more. The long tail is
 * ordinary friction — a late document, a disputed line item — and ranking it
 * alongside a client with nine open complaints is what makes a management
 * review unreadable. So this ranks by weight of evidence and shows the count,
 * which lets the reader make the same judgement themselves.
 *
 * Ordered by unanswered first, then total. Unanswered is the part the firm
 * controls: eighteen complaints all answered is a difficult client, eight
 * unanswered is a failure of ours, and only the second is a reason to call
 * someone today.
 *
 * THE OWNER IS THE POINT. A fire without a name attached is an observation; the
 * question a manager actually has is who to call. Nulls are shown rather than
 * hidden — an unallocated client with six unanswered complaints is a worse
 * finding than an allocated one, and suppressing it would hide the worst cases.
 */
@injectable()
export class FiresService {
  constructor(@inject('Database') private readonly db: Database) {}

  async get(
    tenantId: string,
    viewer: { userId: string; isAdmin: boolean },
    days = 90,
    limit = 6,
  ): Promise<Fire[]> {
    const clientFilter = isAClient(tenantId, await hasRelationshipsTable(this.db));

    // Same entitlement rule as the rest of the panel: a lead's view of "where
    // the fires are" must not become a way to read accounts they cannot open.
    const scope = viewer.isAdmin
      ? sql``
      : sql`AND p.customer_id IN (
              SELECT customer_id FROM user_accessible_customers WHERE user_id = ${viewer.userId}
            )`;

    const rows = await this.db.execute(sql`
      WITH t AS MATERIALIZED (
        -- ATTRIBUTED BY WHO SENT IT, VIA THE SENDER'S DOMAIN.
        --
        -- This joined email_participants and took whichever row carried a
        -- customer_id, which credits a client for mail they merely RECEIVED. RN
        -- Chidakashi was reported as a fire on the strength of a collections
        -- agency writing TO them: from william.oxner@abc-amega.com, to four
        -- @miko.ai addresses. Of 1,484 participant rows behind this population,
        -- only 275 were cases where the customer actually wrote.
        --
        -- Worse, the participant link is often simply wrong. Complaints from
        -- mike@plantprovisions.com and jayanth@datairis.io carried a customer_id
        -- pointing at OUR OWN company record, so the own-domain exclusion then
        -- deleted them — real urgent client mail, silently dropped.
        --
        -- The sender's domain resolves 446 of 451 of these emails to the right
        -- company. It is also the same path AccountContextService already uses,
        -- so the panel now attributes history and fires the same way.
        --
        -- is_auto_created is deliberately NOT filtered here. That flag records
        -- how a customer ROW was created, not whether the company is real, and
        -- for most clients the auto-created record is the only one carrying
        -- their domain. Excluding it dropped WareIQ Logistics, which has 15
        -- unanswered threads and an 83-day-old one.
        SELECT DISTINCT ON (e.thread_id)
          e.thread_id, e.received_at, e.first_reply_at, cd.customer_id
        FROM emails e
        JOIN email_analyses a
          ON a.email_id = e.id AND a.analysis_type = 'sentiment' AND a.sentiment_value = 'negative'
        JOIN customer_domains cd
          ON lower(cd.domain) = split_part(lower(e.from_email), '@', 2)
         AND cd.tenant_id = e.tenant_id
         ${ownableDomain()}
        JOIN customers c ON c.id = cd.customer_id
        WHERE e.tenant_id = ${tenantId}
          AND e.is_customer_email
          AND e.received_at > now() - (${days} || ' days')::interval
          ${weAreOnTheThread()}
          ${weWereAddressed()}
          ${notAlreadyResolved()}
          AND NOT EXISTS (
            SELECT 1 FROM customer_domains cd
            WHERE cd.customer_id = c.id
              AND lower(cd.domain) IN (
                SELECT split_part(lower(u2.email), '@', 2)
                FROM users u2
                WHERE u2.tenant_id = ${tenantId} AND u2.email LIKE '%@%'
                GROUP BY 1
                HAVING count(*) >= ${OWN_DOMAIN_MIN_STAFF}
              )
          )
          ${clientFilter}
          ${scope}
        ORDER BY e.thread_id, e.received_at DESC
      )
      , monthly AS (
        -- Complaint RATE per month, which the thread-level CTE above cannot
        -- give: it holds only negatives, and a rate needs the denominator.
        -- Months with fewer than six emails are dropped rather than shown — one
        -- angry email out of two is 50% and means nothing.
        SELECT cd.customer_id,
               date_trunc('month', e.received_at) AS mon,
               count(*)::int AS mail,
               count(*) FILTER (
                 WHERE a.analysis_type = 'sentiment' AND a.sentiment_value = 'negative'
               )::int AS neg
        FROM emails e
        JOIN email_analyses a ON a.email_id = e.id AND a.analysis_type = 'sentiment'
        JOIN customer_domains cd
          ON lower(cd.domain) = split_part(lower(e.from_email), '@', 2)
         AND cd.tenant_id = e.tenant_id
        WHERE e.tenant_id = ${tenantId}
          AND e.is_customer_email
          AND e.received_at > now() - interval '4 months'
          AND a.sentiment_value IS NOT NULL
        GROUP BY 1, 2
        HAVING count(*) >= 6
      )
      SELECT
        c.id::text AS customer_id,
        COALESCE(c.name, '(unknown)') AS customer,
        count(*)::int AS negative,
        count(*) FILTER (WHERE t.first_reply_at IS NULL)::int AS unanswered,
        MAX(EXTRACT(EPOCH FROM (now() - t.received_at)) / 86400)::int AS oldest_days,
        MAX(al.who) AS owner,
        MAX(al.role) AS owner_role,
        MAX(al.peers) AS owner_peers,
        (
          SELECT array_agg(round(100.0 * m.neg / m.mail)::int ORDER BY m.mon)
          FROM monthly m WHERE m.customer_id = c.id
        ) AS arc
      FROM t
      JOIN customers c ON c.id = t.customer_id
      -- The best available role, not only Account manager.
      --
      -- Reading only role = 'Account manager' meant a client with a
      -- Controller, an Accountant and two Bookkeepers on the sheet still
      -- rendered "no account manager" — technically true, and useless to
      -- someone deciding who to call. Manpreet Kaur Saini is an Accountant on
      -- nine clients and could never appear.
      --
      -- Ordered by who is accountable for the relationship first and who does
      -- the work last, so the answer degrades gracefully instead of vanishing.
      LEFT JOIN LATERAL (
        SELECT al.role,
               COALESCE(u.first_name || ' ' || u.last_name, al.email) AS who,
               -- How many people share that role on this client. 61 client/role
               -- pairs have two, which the row has to admit rather than pick a
               -- winner from silently.
               count(*) OVER (PARTITION BY al.role)::int AS peers
        FROM customer_allocations al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE al.customer_id = c.id AND al.tenant_id = ${tenantId}
        ORDER BY CASE al.role
                   WHEN 'Account manager' THEN 1
                   WHEN 'Sr. Controller'  THEN 2
                   WHEN 'Controller'      THEN 3
                   WHEN 'Accountant'      THEN 4
                   WHEN 'Bookkeeper'      THEN 5
                   WHEN 'Sales rep'       THEN 6
                   ELSE 7
                 END,
                 -- Deterministic tiebreak. Without it LIMIT 1 picks whichever
                 -- row the plan reaches first: Deserve has two account managers
                 -- and the panel showed Sukrati Gupta on one render and Neeraja
                 -- Suryadevara on the next. A name that changes between
                 -- refreshes is worse than either name.
                 who
        LIMIT 1
      ) al ON TRUE
      GROUP BY c.id, c.name
      ORDER BY 4 DESC, 3 DESC
      LIMIT ${limit}
    `);

    return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      customerId: (r.customer_id as string | null) ?? null,
      customer: String(r.customer ?? '(unknown)'),
      negative: Number(r.negative ?? 0),
      unanswered: Number(r.unanswered ?? 0),
      oldestDays: Number(r.oldest_days ?? 0),
      owner: (r.owner as string | null) ?? null,
      ownerRole: (r.owner_role as string | null) ?? null,
      // Postgres returns an int[] or null; a client with too little mail in any
      // month has no arc rather than a misleading one.
      arc: Array.isArray(r.arc) ? (r.arc as unknown[]).map((n) => Number(n)) : [],
      ownerPeers: Number(r.owner_peers ?? 1),
    }));
  }
}

export interface SlowResponder {
  name: string;
  /** For the deep link. Null when the sheet has an address we cannot resolve. */
  userId: string | null;
  /** Negative threads answered — the sample behind the median. */
  threads: number;
  medianH: number;
}

/**
 * Who is slowest to answer angry mail — the people to investigate with.
 *
 * `DangerPulseService` gives the firm's median (12.9h) and its tail (p90 139h),
 * which says something is wrong somewhere but not where. This resolves it to a
 * person, which is the only form in which the number leads to a conversation.
 *
 * The spread is the finding. Against a firm median of 12.9 hours, the slowest
 * account manager sits at 79.3h over ten threads and the next at 50.1h over
 * twenty-two — six times and four times the firm. That is not a rounding
 * difference in an average; it is a small number of people whose angry clients
 * wait days, and a manager who knows their names can ask why.
 *
 * ATTRIBUTED BY ALLOCATION, NOT BY WHO REPLIED. `first_reply_by_id` is 7%
 * populated because replies are never stored, so ranking on it ranks whoever
 * happens to be attributable. The allocation sheet names one accountable person
 * per client, and the question here is accountability rather than authorship:
 * if a client's angry mail waits three days, that is their account manager's
 * problem whoever eventually typed the reply.
 *
 * MINIMUM SAMPLE. A median over two threads is an anecdote with a decimal
 * point, and the person it names has no way to argue with it. Five is low but
 * defensible for a panel that is pointing at a conversation rather than
 * concluding one, and the count is always shown beside the figure so the reader
 * can discount it themselves. Forty account managers clear it, carrying ~12
 * negative threads each.
 *
 * Only ANSWERED threads count, which is deliberate and is the limitation to
 * state plainly: a thread nobody ever replied to has no duration and cannot
 * enter a median. Someone who ignores angry mail entirely looks better here
 * than someone who answers slowly. That case is what `FiresService` and the
 * unanswered counts are for — the two sections have to be read together.
 */
@injectable()
export class SlowRespondersService {
  constructor(@inject('Database') private readonly db: Database) {}

  async get(tenantId: string, days = 90, minThreads = 5, limit = 4): Promise<SlowResponder[]> {
    const clientFilter = isAClient(tenantId, await hasRelationshipsTable(this.db));
    const rows = await this.db.execute(sql`
      SELECT
        COALESCE(u.first_name || ' ' || u.last_name, al.email) AS who,
        MAX(u.id::text) AS user_id,
        count(*)::int AS threads,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (e.first_reply_at - e.received_at)) / 3600
        ) AS median_h
      FROM emails e
      JOIN email_analyses a
        ON a.email_id = e.id AND a.analysis_type = 'sentiment' AND a.sentiment_value = 'negative'
      JOIN email_participants p ON p.email_id = e.id AND p.customer_id IS NOT NULL
      JOIN customers c ON c.id = p.customer_id
      JOIN customer_allocations al
        ON al.customer_id = c.id AND al.tenant_id = ${tenantId} AND al.role = 'Account manager'
      LEFT JOIN users u ON u.id = al.user_id
      WHERE e.tenant_id = ${tenantId}
        AND e.is_customer_email
        AND e.first_reply_at IS NOT NULL
        -- Same guard as DangerPulse: the reply matcher can mis-associate, and a
        -- negative duration would drag a median toward a number nobody can act on.
        AND e.first_reply_at > e.received_at
        AND e.received_at > now() - (${days} || ' days')::interval
        ${weAreOnTheThread()}
        -- Mail addressed elsewhere is not our reply time. Without this a
        -- client's thread with their own vendor counts against the person who
        -- owns the account here.
        ${weWereAddressed()}
        AND NOT c.is_auto_created
        ${clientFilter}
      GROUP BY 1
      HAVING count(*) >= ${minThreads}
        -- SLOWER THAN THE FIRM, or not on this list at all.
        --
        -- There was no floor: the query took the top N by median, so whoever
        -- happened to be at the top appeared under the heading "Slowest to
        -- answer angry mail" however fast they were. Piyush Garg answers angry
        -- clients in 54 MINUTES -- a tenth of the firm median -- and was named
        -- in a list whose whole rhetorical force is that the people on it are
        -- failing.
        --
        -- That is not a ranking error, it is an unfair one. A section that
        -- names individuals has to earn the right to name each of them, and the
        -- bar is being genuinely worse than the firm they are measured against.
        -- If nobody clears it the section renders empty, which is the correct
        -- outcome: nobody is slow.
        AND percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (e.first_reply_at - e.received_at)) / 3600
            ) > (
              SELECT percentile_cont(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (e2.first_reply_at - e2.received_at)) / 3600
                     )
              FROM emails e2
              JOIN email_analyses a2
                ON a2.email_id = e2.id AND a2.analysis_type = 'sentiment'
               AND a2.sentiment_value = 'negative'
              WHERE e2.tenant_id = ${tenantId}
                AND e2.is_customer_email
                AND e2.first_reply_at IS NOT NULL
                AND e2.first_reply_at > e2.received_at
                AND e2.received_at > now() - (${days} || ' days')::interval
            )
      -- BY NAME, not by position.
      --
      -- This ordered by column position. Adding user_id as the second column
      -- for the per-person deep link silently shifted the third column from the
      -- median to the thread count, so a section titled "Slowest to answer
      -- angry mail" ranked people by VOLUME and led with someone at 0.7x the
      -- firm -- faster than average, at the top of a slowest list. Positional
      -- ordering breaks with no compile error and no test failure; a named
      -- column cannot.
      ORDER BY median_h DESC
      LIMIT ${limit}
    `);

    return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      name: String(r.who ?? '(unknown)'),
      userId: (r.user_id as string | null) ?? null,
      threads: Number(r.threads ?? 0),
      medianH: Math.round(Number(r.median_h ?? 0) * 10) / 10,
    }));
  }
}

/**
 * A client whose mail has suddenly doubled, before anyone has complained.
 *
 * Every other signal in this panel reacts to a complaint that has already been
 * written. This one fires first. Measured over 265 clients who eventually
 * complained: median daily mail ran 0.21 in the prior month and 0.43 in the
 * final week before the first complaint, and volume rose in 180 of them — 68%.
 * Clients rock themselves into anger, and the back-and-forth intensifies before
 * the complaint lands.
 *
 * Two properties earn it a place. It costs nothing — counting messages per
 * sender per day, no model call and no vector — and it PRECEDES the label rather
 * than restating it, which nothing built on embeddings managed: a per-client mood
 * centroid stayed flat through a real escalation, ego state did not move, and
 * clients at their angriest still read as Adult stance.
 *
 * DELIBERATELY EXCLUDES CLIENTS WHO HAVE ALREADY COMPLAINED. They are on the
 * fires list, where the arc says whether they are rising or entrenched. Repeating
 * them here would make the loud clients louder and bury the quiet one who is
 * about to become a problem, which is the only thing this section is for.
 *
 * WHAT IT IS NOT. Causation is unsettled: a busy month produces both more mail
 * and more chances for friction, so this may be "activity precedes complaints"
 * rather than "frustration builds". A client at twice their usual volume is not
 * necessarily angry. The row says what it knows — the volume — and does not
 * assert a mood.
 */
export interface Stirring {
  customer: string;
  customerId: string | null;
  /** Messages in the last 7 days. */
  recent: number;
  /** Their usual, as messages per week over the preceding 4 weeks. */
  usual: number;
  owner: string | null;
}

@injectable()
export class StirringService {
  constructor(@inject('Database') private readonly db: Database) {}

  async get(tenantId: string, limit = 4): Promise<Stirring[]> {
    const rows = await this.db.execute(sql`
      WITH ours AS (
        -- Domains where STAFF have accounts are us, not a client. Derived rather
        -- than listed: a hand-maintained exclusion list once contained a real
        -- paying customer.
        SELECT split_part(lower(u.email), '@', 2) AS dom
        FROM users u
        WHERE u.tenant_id = ${tenantId} AND u.email LIKE '%@%'
        GROUP BY 1 HAVING count(*) >= ${OWN_DOMAIN_MIN_STAFF}
      ),
      vol AS (
        SELECT cd.customer_id,
               count(*) FILTER (WHERE e.received_at >= now() - interval '7 days')::int AS recent,
               count(*) FILTER (WHERE e.received_at <  now() - interval '7 days'
                                  AND e.received_at >= now() - interval '35 days')::int AS prior,
               count(*) FILTER (
                 WHERE ea.sentiment_value = 'negative'
                   AND e.received_at >= now() - interval '35 days'
               )::int AS complaints,
               -- Proof a human is on the other side of this.
               count(*) FILTER (WHERE e.first_reply_at IS NOT NULL)::int AS we_replied
        FROM emails e
        JOIN customer_domains cd
          ON lower(cd.domain) = split_part(lower(e.from_email), '@', 2)
         AND cd.tenant_id = e.tenant_id
        LEFT JOIN email_analyses ea
          ON ea.email_id = e.id AND ea.analysis_type = 'sentiment'
        WHERE e.tenant_id = ${tenantId}
          AND e.is_customer_email
          AND e.received_at >= now() - interval '35 days'
          AND split_part(lower(e.from_email), '@', 2) NOT IN (SELECT dom FROM ours)
        GROUP BY cd.customer_id
      )
      SELECT c.id::text AS customer_id,
             COALESCE(c.name, '(unknown)') AS customer,
             v.recent,
             -- Their prior four weeks expressed as a weekly rate, so the row
             -- compares like with like.
             round(v.prior / 4.0)::int AS usual,
             (SELECT COALESCE(u.first_name || ' ' || u.last_name, al.email)
                FROM customer_allocations al
                LEFT JOIN users u ON u.id = al.user_id
               WHERE al.customer_id = c.id AND al.tenant_id = ${tenantId}
               ORDER BY CASE al.role WHEN 'Account manager' THEN 1 ELSE 2 END
               LIMIT 1) AS owner
      FROM vol v
      JOIN customers c ON c.id = v.customer_id
      WHERE v.complaints = 0
        -- Enough history to have a "usual" at all, and enough mail this week for
        -- the ratio to mean something. Two emails against one is noise.
        AND v.prior >= 8
        AND v.recent >= 4
        AND v.recent > (v.prior / 4.0) * 2
        -- WE MUST HAVE REPLIED. Without this the list is machines: the top hits
        -- were Gotowebinar at 270 messages, Versapay at 123, ExceedLMS at 137 —
        -- notification streams whose volume swings for reasons nobody should be
        -- called about. The fires list never had this problem because it
        -- requires a negative verdict and automated mail rarely earns one; a
        -- volume signal has no such protection and needs its own.
        AND v.we_replied >= 3
      ORDER BY v.recent::float / NULLIF(v.prior / 4.0, 0) DESC
      LIMIT ${limit}
    `);

    return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      customerId: (r.customer_id as string | null) ?? null,
      customer: String(r.customer ?? '(unknown)'),
      recent: Number(r.recent ?? 0),
      usual: Number(r.usual ?? 0),
      owner: (r.owner as string | null) ?? null,
    }));
  }
}
