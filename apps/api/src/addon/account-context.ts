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
      INSERT INTO tasks (id, tenant_id, customer_id, title, status, assigned_to_id, created_by_system)
      VALUES (gen_random_uuid(), ${tenantId}, ${customerId}, ${title}, 1, ${viewer.userId}, false)
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
function isAClient(tenantId: string): SQL {
  return sql`
    AND NOT EXISTS (
      SELECT 1 FROM customer_relationships cr
      WHERE cr.customer_id = c.id AND cr.tenant_id = ${tenantId}
    )
  `;
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

    const own = opts.ownDomains.length
      ? sql`AND lower(c.name) <> ALL(${opts.ownDomains.map((d) => d.split('.')[0].toLowerCase())})`
      : sql``;

    const rows = await this.db.execute(sql`
      SELECT DISTINCT ON (e.thread_id)
        c.id::text            AS customer_id,
        COALESCE(c.name, '(unknown)') AS customer,
        e.subject,
        COALESCE(e.from_name, e.from_email) AS from_who,
        GREATEST(0, EXTRACT(EPOCH FROM (now() - e.received_at)) / 86400)::int AS days_waiting,
        COALESCE(a.reasoning, '') AS reason
      FROM emails e
      JOIN email_analyses a
        ON a.email_id = e.id AND a.analysis_type = 'sentiment' AND a.sentiment_value = 'negative'
      LEFT JOIN email_participants p ON p.email_id = e.id AND p.customer_id IS NOT NULL
      LEFT JOIN customers c ON c.id = p.customer_id
      WHERE e.tenant_id = ${tenantId}
        AND e.first_reply_at IS NULL
        AND e.is_customer_email
        AND e.received_at > now() - (${opts.days} || ' days')::interval
        ${weAreOnTheThread()}
        ${own}
        ${isAClient(tenantId)}
        ${scope}
      ORDER BY e.thread_id, e.received_at DESC
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
    const base = sql`
      FROM emails e
      JOIN email_analyses a ON a.email_id = e.id AND a.analysis_type = 'sentiment'
      WHERE e.tenant_id = ${tenantId}
        AND e.is_customer_email
        AND e.first_reply_at IS NOT NULL
        AND e.first_reply_at > e.received_at
        AND e.received_at > now() - (${days} || ' days')::interval
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
        ) AS p90_h
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
    const rows = await this.db.execute(sql`
      WITH t AS (
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
        ${isAClient(tenantId)}
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
      WITH t AS (
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
        ${isAClient(tenantId)}
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
  /** The account manager to call, or null when the client is not allocated. */
  owner: string | null;
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
    // Same entitlement rule as the rest of the panel: a lead's view of "where
    // the fires are" must not become a way to read accounts they cannot open.
    const scope = viewer.isAdmin
      ? sql``
      : sql`AND p.customer_id IN (
              SELECT customer_id FROM user_accessible_customers WHERE user_id = ${viewer.userId}
            )`;

    const rows = await this.db.execute(sql`
      WITH t AS (
        SELECT DISTINCT ON (e.thread_id)
          e.thread_id, e.received_at, e.first_reply_at, p.customer_id
        FROM emails e
        JOIN email_analyses a
          ON a.email_id = e.id AND a.analysis_type = 'sentiment' AND a.sentiment_value = 'negative'
        JOIN email_participants p ON p.email_id = e.id AND p.customer_id IS NOT NULL
        JOIN customers c ON c.id = p.customer_id
        WHERE e.tenant_id = ${tenantId}
          AND e.is_customer_email
          AND e.received_at > now() - (${days} || ' days')::interval
          ${weAreOnTheThread()}
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
          ${isAClient(tenantId)}
          ${scope}
        ORDER BY e.thread_id, e.received_at DESC
      )
      SELECT
        c.id::text AS customer_id,
        COALESCE(c.name, '(unknown)') AS customer,
        count(*)::int AS negative,
        count(*) FILTER (WHERE t.first_reply_at IS NULL)::int AS unanswered,
        MAX(EXTRACT(EPOCH FROM (now() - t.received_at)) / 86400)::int AS oldest_days,
        MAX(u.first_name || ' ' || u.last_name) AS owner
      FROM t
      JOIN customers c ON c.id = t.customer_id
      LEFT JOIN customer_allocations al
        ON al.customer_id = c.id AND al.tenant_id = ${tenantId} AND al.role = 'Account manager'
      LEFT JOIN users u ON u.id = al.user_id
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
    }));
  }
}

export interface SlowResponder {
  name: string;
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
    const rows = await this.db.execute(sql`
      SELECT
        COALESCE(u.first_name || ' ' || u.last_name, al.email) AS who,
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
        AND NOT c.is_auto_created
        ${isAClient(tenantId)}
      GROUP BY 1
      HAVING count(*) >= ${minThreads}
      ORDER BY 3 DESC
      LIMIT ${limit}
    `);

    return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      name: String(r.who ?? '(unknown)'),
      threads: Number(r.threads ?? 0),
      medianH: Math.round(Number(r.median_h ?? 0) * 10) / 10,
    }));
  }
}
