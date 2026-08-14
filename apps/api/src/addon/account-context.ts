import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
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
        ${own}
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
}

/**
 * Who is carrying the unanswered angry mail.
 *
 * The management-review question, and getting the ATTRIBUTION right is most of
 * the work. Three candidate sources, only one of which holds up:
 *
 *   first_reply_by_id — 7% populated on negative mail. Replies are never
 *     stored (see emails/service.ts: they are matched for a timestamp and
 *     discarded), so there is usually no row to attribute. A ranking on 7%
 *     coverage ranks who happens to be attributable.
 *
 *   user_customers — 100% for assigned customers, but a customer carries FOUR
 *     TO FIVE owners and `role_id` is null on all 4,111 mappings, so nothing
 *     distinguishes the accountable one. Counting per owner turns 188 threads
 *     into 379 person-thread pairs: the same complaint charged to five people.
 *
 *   tasks.assigned_to_id — ONE assignee per task. No double counting, and it is
 *     the same field the manager UI already calls "Assigned To". 57% coverage
 *     on this population, and the 43% with no assignee is not a gap to hide —
 *     it is the largest single group and the most useful thing on the list.
 *
 * So: task assignment, with unassigned reported as its own row rather than
 * dropped. A review that silently omits the biggest bucket is worse than no
 * review.
 */
@injectable()
export class OwnerLoadService {
  constructor(@inject('Database') private readonly db: Database) {}

  async get(tenantId: string, days = 30, limit = 8): Promise<OwnerLoad[]> {
    const rows = await this.db.execute(sql`
      SELECT
        COALESCE(u.first_name || ' ' || u.last_name, '(unassigned)') AS who,
        (t.assigned_to_id IS NULL) AS is_unassigned,
        count(*)::int AS threads,
        MAX(EXTRACT(EPOCH FROM (now() - x.received_at)) / 86400)::int AS oldest_days
      FROM (
        -- One row per THREAD, newest message. Without this a single complaint
        -- counts once per message and once per participant.
        SELECT DISTINCT ON (e.thread_id) e.id, e.thread_id, e.received_at
        FROM emails e
        JOIN email_analyses a
          ON a.email_id = e.id AND a.analysis_type = 'sentiment' AND a.sentiment_value = 'negative'
        WHERE e.tenant_id = ${tenantId}
          AND e.first_reply_at IS NULL
          AND e.is_customer_email
          AND e.received_at > now() - (${days} || ' days')::interval
        ORDER BY e.thread_id, e.received_at DESC
      ) x
      LEFT JOIN tasks t ON t.email_id = x.id
      LEFT JOIN users u ON u.id = t.assigned_to_id
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT ${limit}
    `);

    return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      name: String(r.who),
      threads: Number(r.threads ?? 0),
      oldestDays: Number(r.oldest_days ?? 0),
      unassigned: Boolean(r.is_unassigned),
    }));
  }
}
