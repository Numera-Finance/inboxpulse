import { injectable, inject } from 'tsyringe';
import { ScopedRepository } from '@crm/database';
import type { Database } from '@crm/database';
import { isAdmin, type RequestHeader, Signal } from '@crm/shared';
import { EmailAnalysisStatus } from '../emails/schema';
import { tenants } from '../tenants/schema';
import { eq, sql, SQL } from 'drizzle-orm';

/**
 * Dashboard analytics, ported from the standalone `crm-manager` service
 * (apps/manager/src/server.js) into crm-api.
 *
 * Why it moved: crm-manager had no notion of a user. Its only gate was Cloud Run
 * IAM, which meant every operator had to keep a local `gcloud run services
 * proxy` running for the sidebar's dashboard to load at all. It was also
 * single-tenant by environment variable — `TENANT_ID` unset returned rows across
 * every tenant — and applied no per-user access control whatsoever. Running the
 * same SQL inside crm-api picks up session auth, per-request tenant resolution
 * and `user_accessible_customers` scoping for free, and retires the proxy.
 *
 * The SQL bodies are carried over deliberately close to verbatim so the numbers
 * on the dashboard do not move as part of an auth change. What changed is the
 * scoping, and only the scoping:
 *
 *   - `TENANT_ID` (process-wide, optional) → `header.tenantId`, always applied.
 *   - team-member domains: a hardcoded env list → the tenant's own
 *     `tenants.domains`, so a second tenant gets the right answer.
 *   - NEW: every query is filtered by the caller's accessible customers.
 *
 * That last one means a non-admin will see smaller numbers here than crm-manager
 * showed them. That is the fix, not a regression: crm-manager was reporting
 * customers the same user cannot open anywhere else in the product.
 */
@injectable()
export class ManagerRepository extends ScopedRepository {
  constructor(@inject('Database') db: Database) {
    super(db);
  }

  /**
   * Per-user customer scoping against the `ep` alias used throughout this file.
   *
   * `ScopedRepository.customerAccessFilter` takes a typed Drizzle column, which
   * these hand-written queries don't have — they join `email_participants` under
   * an alias. Same predicate, same table, expressed for raw SQL.
   */
  private accessScope(header: RequestHeader): SQL {
    if (isAdmin(header.permissions)) return sql`true`;
    return sql`ep.customer_id IN (
      SELECT uac.customer_id
      FROM user_accessible_customers uac
      WHERE uac.user_id = ${header.userId}
    )`;
  }

  /**
   * The same per-user scoping as `accessScope`, but against a customer id
   * column rather than the `ep` alias — for the Customers section, which has no
   * email_participants join to hang it off.
   */
  private customerScope(header: RequestHeader, column: SQL): SQL {
    if (isAdmin(header.permissions)) return sql`true`;
    return sql`${column} IN (
      SELECT uac.customer_id
      FROM user_accessible_customers uac
      WHERE uac.user_id = ${header.userId}
    )`;
  }

  /**
   * Predicates shared by every dashboard query: analyzed, sender is a customer,
   * this tenant, and visible to this user.
   */
  private baseParts(header: RequestHeader): SQL[] {
    return [
      sql`e.analysis_status = ${EmailAnalysisStatus.Completed}`,
      sql`ep.customer_id IS NOT NULL`,
      sql`e.tenant_id = ${header.tenantId}`,
      this.accessScope(header),
    ];
  }

  /** Date-range predicates against e.received_at. */
  private dateRangeParts(dateFrom?: string, dateTo?: string): SQL[] {
    const parts: SQL[] = [];
    const from = parseDayStart(dateFrom);
    const to = parseDayEnd(dateTo);
    if (from) parts.push(sql`e.received_at >= ${from}::timestamptz`);
    if (to) parts.push(sql`e.received_at <= ${to}::timestamptz`);
    return parts;
  }

  /** The dashboard's top-bar customer / team-member filters. */
  private scopeParts(filters: DashboardFilters): SQL[] {
    const parts: SQL[] = [];
    if (filters.customerId) parts.push(sql`ep.customer_id = ${filters.customerId}`);
    if (filters.teamMemberId) {
      // Account-ownership semantics: the email's customer is one this member owns.
      parts.push(sql`EXISTS (
        SELECT 1 FROM user_customers uc
        WHERE uc.customer_id = ep.customer_id AND uc.user_id = ${filters.teamMemberId}
      )`);
    }
    return parts;
  }

  private where(header: RequestHeader, filters: DashboardFilters): SQL {
    return joinAnd([
      ...this.baseParts(header),
      ...this.dateRangeParts(filters.dateFrom, filters.dateTo),
      ...this.scopeParts(filters),
    ]);
  }

  /**
   * The tenant's own email domains, used to tell a team member's message from a
   * customer's when measuring reply time. crm-manager read this from a
   * comma-separated env var defaulting to two hardcoded domains, which is wrong
   * for any other tenant.
   */
  private async teamDomains(header: RequestHeader): Promise<string[]> {
    const [row] = await this.db
      .select({ domains: tenants.domains })
      .from(tenants)
      .where(eq(tenants.id, header.tenantId))
      .limit(1);
    return (row?.domains ?? []).map((d) => d.toLowerCase());
  }

  /** The four headline tiles, in one call so they refresh together. */
  async getSummary(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<{
    customers: number;
    emails: number;
    activeEscalations: number;
    upsellOpportunities: number;
  }> {
    const where = this.where(header, filters);

    const emailRows = (await this.db.execute(sql`
      SELECT
        COUNT(DISTINCT e.id)::int AS total,
        COUNT(DISTINCT e.id) FILTER (
          WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]
            AND t.id IS NOT NULL AND t.status = 0
        )::int AS active_escalations,
        COUNT(DISTINCT e.id) FILTER (
          WHERE e.signals @> ARRAY[${Signal.UPSELL}]::integer[]
            AND t.id IS NOT NULL AND t.status = 0
        )::int AS upsell_opportunities
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      LEFT  JOIN tasks t ON t.email_id = e.id
      WHERE ${where}
    `)) as unknown as Array<{
      total: number;
      active_escalations: number;
      upsell_opportunities: number;
    }>;

    // Distinct customers with any analyzed email in range, so the tile moves
    // with the date filter rather than reporting the all-time customer count.
    const custRows = (await this.db.execute(sql`
      SELECT COUNT(DISTINCT ep.customer_id)::int AS active_customers
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      WHERE ${where}
    `)) as unknown as Array<{ active_customers: number }>;

    return {
      customers: custRows[0]?.active_customers ?? 0,
      emails: emailRows[0]?.total ?? 0,
      activeEscalations: emailRows[0]?.active_escalations ?? 0,
      upsellOpportunities: emailRows[0]?.upsell_opportunities ?? 0,
    };
  }

  /** Sentiment split for the donut. */
  async getSentimentDistribution(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<{ positive: number; neutral: number; negative: number }> {
    const where = this.where(header, filters);

    const rows = (await this.db.execute(sql`
      SELECT
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[])::int AS positive,
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEUTRAL}]::integer[])::int  AS neutral,
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[])::int AS negative
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      WHERE ${where}
    `)) as unknown as Array<{ positive: number; neutral: number; negative: number }>;

    return {
      positive: rows[0]?.positive ?? 0,
      neutral: rows[0]?.neutral ?? 0,
      negative: rows[0]?.negative ?? 0,
    };
  }

  /** Churn-risk counts by level, for the risk breakdown tile. */
  async getChurnLevels(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<{ low: number; medium: number; high: number; critical: number }> {
    const where = this.where(header, filters);

    const rows = (await this.db.execute(sql`
      SELECT
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.CHURN_LOW}]::integer[])::int      AS low,
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.CHURN_MEDIUM}]::integer[])::int   AS medium,
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.CHURN_HIGH}]::integer[])::int     AS high,
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.CHURN_CRITICAL}]::integer[])::int AS critical
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      WHERE ${where}
    `)) as unknown as Array<{ low: number; medium: number; high: number; critical: number }>;

    return {
      low: rows[0]?.low ?? 0,
      medium: rows[0]?.medium ?? 0,
      high: rows[0]?.high ?? 0,
      critical: rows[0]?.critical ?? 0,
    };
  }

  /**
   * Recent open escalation TASKS — one row per task, newest first.
   *
   * Task-shaped, not email-shaped, and that is the whole point: the table's
   * columns are Created and Assigned To, which only exist on a task. The first
   * port listed negative emails instead and returned receivedAt / no assignee,
   * so both of those columns rendered empty and "Unassigned" on every row.
   *
   * The date range applies to `t.created_at` (when the escalation was raised),
   * not to the email's received_at — so this deliberately builds its own
   * predicate list rather than using `this.where()`.
   */
  async getRecentEscalations(
    header: RequestHeader,
    filters: DashboardFilters,
    limit = 8
  ): Promise<RecentEscalationRow[]> {
    const capped = Math.min(50, Math.max(1, limit));

    const parts: SQL[] = [
      sql`t.status = 0`,
      sql`e.analysis_status = ${EmailAnalysisStatus.Completed}`,
      sql`e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]`,
      sql`ep.customer_id IS NOT NULL`,
      sql`e.tenant_id = ${header.tenantId}`,
      this.accessScope(header),
      ...this.scopeParts(filters),
    ];
    const from = parseDayStart(filters.dateFrom);
    const to = parseDayEnd(filters.dateTo);
    if (from) parts.push(sql`t.created_at >= ${from}::timestamptz`);
    if (to) parts.push(sql`t.created_at <= ${to}::timestamptz`);

    const rows = (await this.db.execute(sql`
      SELECT
        t.id         AS "taskId",
        t.created_at AS "createdAt",
        ep.customer_id AS "customerId",
        c.name       AS "customerName",
        -- The task's own problem statement stands in when the email has no
        -- subject, so a row is never blank in the column the reader scans.
        COALESCE(NULLIF(e.subject, ''), NULLIF(t.problem, ''), '(no subject)') AS "subject",
        NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS "assignedToName"
      FROM tasks t
      INNER JOIN emails e ON e.id = t.email_id
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      LEFT  JOIN users u ON u.id = t.assigned_to_id
      WHERE ${joinAnd(parts)}
      ORDER BY t.created_at DESC
      LIMIT ${capped}
    `)) as unknown as RecentEscalationRow[];

    return rows;
  }

  /**
   * Important escalations: threads whose MOST RECENT customer email is negative
   * AND still has an open task — i.e. that latest message is itself an active
   * escalation (the same negative + open-task condition the Active Escalations
   * KPI counts), not merely a thread that contained a negative email at some
   * earlier point and has since moved on. Ranked by the LENGTH OF THE REPLY
   * CHAIN — the total number of messages in the thread, customer and team
   * alike — longest first, so the most drawn-out live escalations surface.
   *
   * The first port of this method into crm-api reduced it to "negative emails
   * with an open task, oldest first" and returned an email-shaped row
   * (emailId/subject/receivedAt/ageDays). The tile renders thread-shaped rows —
   * `messageCount`, `firstAt`, `lastAt` — so every row drew as "0 messages"
   * with an empty bar and no dates. This restores the crm-manager query
   * (apps/manager/src/server.js `getImportantEscalations`) and its result shape.
   */
  async getImportantEscalations(
    header: RequestHeader,
    filters: DashboardFilters,
    limit = 4
  ): Promise<ImportantEscalationRow[]> {
    const capped = Math.min(50, Math.max(1, limit));

    // Deliberately NOT this.where(): the ranking window must see every email in
    // the thread, so neither `analysis_status = completed` nor the date range
    // may narrow it. An unanalyzed reply still makes an older negative message
    // no longer the latest one, and the date range scopes the thread's last
    // activity (`l.last_at` below), not which email counts as the latest.
    const rankedWhere = joinAnd([
      sql`ep.customer_id IS NOT NULL`,
      sql`e.tenant_id = ${header.tenantId}`,
      this.accessScope(header),
      ...this.scopeParts(filters),
    ]);

    // The qualifying condition is on the thread's latest customer email (`l`):
    // negative, with an open task. last_at (= that email's time) is what the
    // dashboard date range scopes on.
    const finalParts: SQL[] = [
      sql`l.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]`,
      sql`l.task_id IS NOT NULL`,
      sql`l.task_status = 0`,
    ];
    const from = parseDayStart(filters.dateFrom);
    const to = parseDayEnd(filters.dateTo);
    if (from) finalParts.push(sql`l.last_at >= ${from}::timestamptz`);
    if (to) finalParts.push(sql`l.last_at <= ${to}::timestamptz`);
    const finalWhere = joinAnd(finalParts);

    const rows = (await this.db.execute(sql`
      WITH ranked AS (
        SELECT
          e.thread_id,
          ep.customer_id,
          e.id     AS email_id,
          e.signals,
          t.id     AS task_id,
          t.status AS task_status,
          ROW_NUMBER() OVER (PARTITION BY e.thread_id ORDER BY e.received_at DESC) AS rn,
          MIN(e.received_at) OVER (PARTITION BY e.thread_id) AS first_at,
          MAX(e.received_at) OVER (PARTITION BY e.thread_id) AS last_at
        FROM emails e
        INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
        LEFT  JOIN tasks t ON t.email_id = e.id
        WHERE ${rankedWhere}
      ),
      latest AS (
        -- One row per thread: its most recent customer email, carrying that
        -- email's signals + task status and the thread's first/last timestamps.
        SELECT * FROM ranked WHERE rn = 1
      )
      SELECT
        l.thread_id AS "threadId",
        l.email_id  AS "emailId",
        c.id        AS "customerId",
        c.name      AS "customerName",
        th.subject  AS "subject",
        l.first_at  AS "firstAt",
        l.last_at   AS "lastAt",
        (EXTRACT(EPOCH FROM (l.last_at - l.first_at)) / 86400.0)::float8 AS "durationDays",
        -- Full length of the reply chain: every email sharing this thread_id,
        -- customer and team alike (no customer / analysis filter), matching
        -- what the thread view renders. This is the ranking key.
        (
          SELECT COUNT(*)::int
          FROM emails e_all
          WHERE e_all.thread_id = l.thread_id
            AND e_all.tenant_id = ${header.tenantId}
        ) AS "messageCount"
      FROM latest l
      INNER JOIN customers     c  ON c.id  = l.customer_id
      INNER JOIN email_threads th ON th.id = l.thread_id
      WHERE ${finalWhere}
      ORDER BY "messageCount" DESC, "durationDays" DESC
      LIMIT ${capped}
    `)) as unknown as ImportantEscalationRow[];

    return rows;
  }

  /**
   * Most dissatisfied customers: those with more than 10 analyzed emails in
   * range, ranked by the SHARE of those emails that is negative.
   *
   * The share, not the raw count, is the point — ranking by count just re-ranks
   * by volume and puts the busiest customer on top no matter how well the
   * relationship is going. The >10 floor is what makes a share meaningful; one
   * negative email out of two is not a dissatisfied customer. Both rules are
   * already stated in the tile's own subtitle and empty state.
   *
   * The first port dropped both, ranked by count, and returned
   * `escalations`/`emails` where the tile reads `negative`/`total`/`ratio` —
   * so every row rendered "undefined of undefined negative · NaN%" over a meter
   * whose width was the string "NaN%", which CSS discards, leaving every bar
   * full. Restores the crm-manager query (apps/manager/src/server.js
   * `getMostEscalatedCustomers`) and its result shape.
   */
  async getMostEscalatedCustomers(
    header: RequestHeader,
    filters: DashboardFilters,
    limit = 4
  ): Promise<MostEscalatedRow[]> {
    const where = this.where(header, filters);
    const capped = Math.min(50, Math.max(1, limit));

    const rows = (await this.db.execute(sql`
      SELECT
        ep.customer_id AS "customerId",
        c.name         AS "customerName",
        COUNT(DISTINCT e.id)::int AS "total",
        COUNT(DISTINCT e.id) FILTER (
          WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]
        )::int AS "negative",
        (
          COUNT(DISTINCT e.id) FILTER (
            WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]
          )::numeric / NULLIF(COUNT(DISTINCT e.id), 0)
        )::float8 AS "ratio"
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      WHERE ${where}
      GROUP BY ep.customer_id, c.name
      HAVING COUNT(DISTINCT e.id) > 10
      ORDER BY "ratio" DESC, "negative" DESC
      LIMIT ${capped}
    `)) as unknown as MostEscalatedRow[];

    return rows;
  }

  /**
   * Monthly positive/negative share over the trailing 6 months.
   *
   * Ignores the date filter by design — it describes a fixed trailing window, so
   * the top bar's range would make it say something other than its own title.
   * Tenant and access scoping still apply.
   */
  async getSentimentTrend(header: RequestHeader): Promise<SentimentTrendRow[]> {
    const where = joinAnd(this.baseParts(header));

    const rows = (await this.db.execute(sql`
      SELECT
        to_char(date_trunc('month', e.received_at), 'YYYY-MM') AS "month",
        COUNT(DISTINCT e.id)::int AS "total",
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[])::int AS "positive",
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[])::int AS "negative"
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      WHERE ${where}
        AND e.received_at >= date_trunc('month', NOW()) - INTERVAL '5 months'
      GROUP BY date_trunc('month', e.received_at)
      ORDER BY date_trunc('month', e.received_at) ASC
    `)) as unknown as SentimentTrendRow[];

    return rows;
  }

  /** Email volume per day in range. */
  async getVolumeTrend(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<VolumeTrendRow[]> {
    const where = this.where(header, filters);

    const rows = (await this.db.execute(sql`
      SELECT
        to_char(date_trunc('day', e.received_at), 'YYYY-MM-DD') AS "day",
        COUNT(DISTINCT e.id)::int AS "total"
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      WHERE ${where}
      GROUP BY date_trunc('day', e.received_at)
      ORDER BY date_trunc('day', e.received_at) ASC
    `)) as unknown as VolumeTrendRow[];

    return rows;
  }

  /**
   * Average time to first team reply, and how many customer messages never got
   * one. "Team" is decided by the sender's domain against the tenant's own
   * domains — see `teamDomains`.
   */
  async getAvgResolutionTime(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<{ averageHours: number | null; replied: number; unreplied: number }> {
    const where = this.where(header, filters);
    const domains = await this.teamDomains(header);

    // No tenant domains configured means every sender looks external and the
    // figure would be meaningless. Say so with nulls rather than print a zero.
    if (domains.length === 0) {
      return { averageHours: null, replied: 0, unreplied: 0 };
    }

    const rows = (await this.db.execute(sql`
      WITH customer_messages AS (
        SELECT e.id, e.thread_id, e.received_at
        FROM emails e
        INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
        WHERE ${where}
          AND NOT (lower(split_part(e.from_email, '@', 2)) = ANY(${domains}))
      ),
      first_reply AS (
        SELECT
          cm.id,
          cm.received_at,
          (
            SELECT MIN(r.received_at)
            FROM emails r
            WHERE r.thread_id = cm.thread_id
              AND r.tenant_id = ${header.tenantId}
              AND r.received_at > cm.received_at
              AND lower(split_part(r.from_email, '@', 2)) = ANY(${domains})
          ) AS replied_at
        FROM customer_messages cm
      )
      SELECT
        AVG(EXTRACT(EPOCH FROM (replied_at - received_at)) / 3600)
          FILTER (WHERE replied_at IS NOT NULL) AS "averageHours",
        COUNT(*) FILTER (WHERE replied_at IS NOT NULL)::int AS "replied",
        COUNT(*) FILTER (WHERE replied_at IS NULL)::int     AS "unreplied"
      FROM first_reply
    `)) as unknown as Array<{
      averageHours: string | number | null;
      replied: number;
      unreplied: number;
    }>;

    const row = rows[0];
    return {
      averageHours: row?.averageHours != null ? Number(row.averageHours) : null,
      replied: row?.replied ?? 0,
      unreplied: row?.unreplied ?? 0,
    };
  }

  /**
   * Per-member reply performance: how many customer messages they answered and
   * how long they took. Attribution is by who actually sent the reply.
   */
  async getTeamResponsiveness(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<TeamResponsivenessRow[]> {
    const where = this.where(header, filters);
    const domains = await this.teamDomains(header);

    if (domains.length === 0) return [];

    const rows = (await this.db.execute(sql`
      WITH customer_messages AS (
        SELECT e.id, e.thread_id, e.received_at
        FROM emails e
        INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
        WHERE ${where}
          AND NOT (lower(split_part(e.from_email, '@', 2)) = ANY(${domains}))
      ),
      replies AS (
        SELECT DISTINCT ON (cm.id)
          cm.id                AS customer_email_id,
          cm.received_at       AS asked_at,
          r.received_at        AS replied_at,
          rp.participant_id    AS user_id
        FROM customer_messages cm
        INNER JOIN emails r
          ON r.thread_id = cm.thread_id
         AND r.tenant_id = ${header.tenantId}
         AND r.received_at > cm.received_at
         AND lower(split_part(r.from_email, '@', 2)) = ANY(${domains})
        INNER JOIN email_participants rp
          ON rp.email_id = r.id AND rp.direction = 'from' AND rp.participant_type = 'user'
        ORDER BY cm.id, r.received_at ASC
      )
      SELECT
        u.id         AS "userId",
        u.first_name AS "firstName",
        u.last_name  AS "lastName",
        u.email      AS "email",
        COUNT(*)::int AS "replies",
        AVG(EXTRACT(EPOCH FROM (replies.replied_at - replies.asked_at)) / 3600) AS "averageHours",
        MAX(EXTRACT(EPOCH FROM (replies.replied_at - replies.asked_at)) / 3600) AS "slowestHours"
      FROM replies
      INNER JOIN users u ON u.id = replies.user_id
      WHERE u.tenant_id = ${header.tenantId}
      GROUP BY u.id, u.first_name, u.last_name, u.email
      ORDER BY "replies" DESC
    `)) as unknown as Array<{
      userId: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
      replies: number;
      averageHours: string | number | null;
      slowestHours: string | number | null;
    }>;

    return rows.map((r) => ({
      userId: r.userId,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      replies: r.replies,
      averageHours: r.averageHours != null ? Number(r.averageHours) : null,
      slowestHours: r.slowestHours != null ? Number(r.slowestHours) : null,
    }));
  }

  /**
   * Business-day TAT buckets per customer. Reuses the same shape the existing
   * /api/emails/tat-metrics returns so the two agree.
   */
  async getTatMetrics(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<TatMetricRow[]> {
    const where = this.where(header, filters);
    const domains = await this.teamDomains(header);

    if (domains.length === 0) return [];

    const rows = (await this.db.execute(sql`
      WITH customer_messages AS (
        SELECT e.id, e.thread_id, e.received_at, ep.customer_id, c.name AS customer_name
        FROM emails e
        INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
        INNER JOIN customers c ON c.id = ep.customer_id
        WHERE ${where}
          AND NOT (lower(split_part(e.from_email, '@', 2)) = ANY(${domains}))
      ),
      with_reply AS (
        SELECT
          cm.customer_id,
          cm.customer_name,
          cm.received_at,
          (
            SELECT MIN(r.received_at)
            FROM emails r
            WHERE r.thread_id = cm.thread_id
              AND r.tenant_id = ${header.tenantId}
              AND r.received_at > cm.received_at
              AND lower(split_part(r.from_email, '@', 2)) = ANY(${domains})
          ) AS replied_at
        FROM customer_messages cm
      ),
      business_days AS (
        SELECT
          customer_id,
          customer_name,
          -- Calendar days minus weekends between ask and reply.
          (
            SELECT COUNT(*)
            FROM generate_series(
              date_trunc('day', received_at),
              date_trunc('day', COALESCE(replied_at, NOW())),
              INTERVAL '1 day'
            ) AS d
            WHERE EXTRACT(ISODOW FROM d) < 6
          ) - 1 AS days
        FROM with_reply
      )
      SELECT
        customer_id   AS "customerId",
        customer_name AS "customerName",
        COUNT(*) FILTER (WHERE days >= 1 AND days < 2)::int AS "onePlusDays",
        COUNT(*) FILTER (WHERE days >= 2 AND days < 3)::int AS "twoPlusDays",
        COUNT(*) FILTER (WHERE days >= 3 AND days < 5)::int AS "threePlusDays",
        COUNT(*) FILTER (WHERE days >= 5 AND days < 6)::int AS "fivePlusDays",
        COUNT(*) FILTER (WHERE days >= 6)::int              AS "sixPlusDays"
      FROM business_days
      WHERE days >= 1
      GROUP BY customer_id, customer_name
      ORDER BY "sixPlusDays" DESC, "fivePlusDays" DESC, "threePlusDays" DESC,
               "twoPlusDays" DESC, "onePlusDays" DESC
    `)) as unknown as TatMetricRow[];

    return rows;
  }

  /**
   * WHERE parts for the AI Analysis list, mirroring the dashboard's base so the
   * KPI tiles and this list count the same population.
   */
  private searchParts(header: RequestHeader, req: AnalyzedSearchRequest): SQL[] {
    const parts = this.baseParts(header);

    if (req.emailId) parts.push(sql`e.id = ${req.emailId}`);

    if (req.signal && req.signal !== 'all') {
      const cond = signalFilter(req.signal);
      if (cond) parts.push(cond);
    }
    if (req.churnLevel && req.churnLevel !== 'all') {
      const cond = churnLevelFilter(req.churnLevel);
      if (cond) parts.push(cond);
    }
    if (req.status && req.status !== 'all') {
      parts.push(sql`t.status = ${req.status === 'done' ? 1 : 0}`);
    }
    if (req.assignedToId) {
      if (req.assignedToId === 'unassigned') {
        parts.push(sql`t.id IS NOT NULL AND t.assigned_to_id IS NULL`);
      } else {
        parts.push(sql`t.assigned_to_id = ${req.assignedToId}`);
      }
    }
    if (req.customerId) parts.push(sql`ep.customer_id = ${req.customerId}`);
    if (req.teamMemberId) {
      // Sender semantics here, not ownership: "this member's threads" means
      // chains they actually replied on.
      parts.push(sql`e.thread_id IN (
        SELECT e_tm.thread_id
        FROM email_participants ep_tm
        INNER JOIN emails e_tm ON e_tm.id = ep_tm.email_id
        WHERE ep_tm.participant_type = 'user'
          AND ep_tm.participant_id = ${req.teamMemberId}
          AND ep_tm.direction = 'from'
      )`);
    }
    if (req.dateFrom) parts.push(sql`e.received_at >= ${req.dateFrom}::timestamptz`);
    if (req.dateTo) parts.push(sql`e.received_at <= ${req.dateTo}::timestamptz`);

    // Every term must land somewhere on the email — subject, a participant, or
    // the body. AND across terms, OR across fields, which is how a mail search
    // is expected to narrow: each word you add removes results.
    for (const term of searchTerms(req.search)) {
      parts.push(sql`(
        e.subject ILIKE ${term}
        OR e.body ILIKE ${term}
        OR e.id IN (
          SELECT ep2.email_id FROM email_participants ep2
          WHERE ep2.email ILIKE ${term} OR ep2.name ILIKE ${term}
        )
      )`);
    }
    return parts;
  }

  /**
   * How well a row answers the query, as a sort key — subject beats sender
   * beats body.
   *
   * Body search is what makes this necessary. Once the body is in scope a
   * common word matches a great many messages, and ordering those purely by
   * date buries the message actually titled after the thing you searched for.
   * A tier is deliberately coarse: within a tier the caller's own sort still
   * decides, so the list stays "newest first" the way the column headers claim.
   *
   * The tiers ask whether the WHOLE query is explained by one field, so a hit
   * only counts as a subject hit when every term is in the subject.
   */
  private relevanceExpr(search?: string): SQL | null {
    const terms = searchTerms(search);
    if (terms.length === 0) return null;

    const allInSubject = joinAnd(terms.map((t) => sql`e.subject ILIKE ${t}`));
    const allInSender = joinAnd(
      terms.map((t) => sql`(e.from_email ILIKE ${t} OR e.from_name ILIKE ${t})`)
    );

    return sql`CASE
      WHEN ${allInSubject} THEN 3
      WHEN ${allInSender}  THEN 2
      ELSE 1
    END`;
  }

  /** The AI Analysis list, paged. */
  async searchAnalyzedEmails(
    header: RequestHeader,
    req: AnalyzedSearchRequest
  ): Promise<{ items: AnalyzedEmailRow[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(200, Math.max(1, req.limit ?? 50));
    const offset = Math.max(0, req.offset ?? 0);
    const where = joinAnd(this.searchParts(header, req));
    const useCreatedAt = req.sortBy === 'createdAt';
    const asc = req.sortOrder === 'asc';

    const countRows = (await this.db.execute(sql`
      SELECT COUNT(DISTINCT ${req.groupByThread ? sql`e.thread_id` : sql`e.id`})::int AS count
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      LEFT  JOIN tasks t ON t.email_id = e.id
      WHERE ${where}
    `)) as unknown as Array<{ count: number }>;
    const total = countRows[0]?.count ?? 0;

    // Sort direction and column are chosen from a closed set, never interpolated
    // from caller input — `sortBy`/`sortOrder` are compared, not injected.
    const innerSort = useCreatedAt ? sql`e.created_at` : sql`e.received_at`;
    const outerSort = useCreatedAt ? sql`created_at` : sql`received_at`;
    const dir = asc ? sql`ASC` : sql`DESC`;

    // Relevance leads the sort only while a search is active; with no query
    // there is nothing to be relevant to and the list is purely chronological.
    // It rides along as a selected column so the groupByThread CTE can order by
    // it too — the extra field is ignored when a row is mapped.
    const relevance = this.relevanceExpr(req.search);
    const relSelect = relevance ? sql`, ${relevance} AS relevance` : sql``;
    const relOrder = relevance ? sql`relevance DESC,` : sql``;

    const selectList = sql`
      e.id, e.thread_id, e.subject, e.body, e.from_email, e.from_name,
      e.tos, e.ccs, e.bccs,
      e.received_at, e.created_at, e.signals,
      ep.customer_id, c.name AS customer_name,
      t.id AS task_id, t.status AS task_status, t.assigned_to_id,
      CONCAT(assignee_u.first_name, ' ', assignee_u.last_name) AS assigned_to_name,
      assignee_u.email AS assigned_to_email,
      t.problem, t.resolution,
      t.completed_at, t.completed_by_id,
      CONCAT(completed_u.first_name, ' ', completed_u.last_name) AS completed_by_name,
      t.created_at AS task_created_at
    `;
    const joins = sql`
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      LEFT  JOIN tasks t ON t.email_id = e.id
      LEFT  JOIN users assignee_u  ON assignee_u.id  = t.assigned_to_id
      LEFT  JOIN users completed_u ON completed_u.id = t.completed_by_id
    `;

    // groupByThread collapses to the newest analyzed email per conversation, so
    // several hits in one thread don't fragment the list.
    const rows = (await this.db.execute(
      req.groupByThread
        ? sql`
          WITH ranked AS (
            SELECT ${selectList}${relSelect},
              ROW_NUMBER() OVER (PARTITION BY e.thread_id ORDER BY e.received_at DESC) AS rn
            ${joins}
            WHERE ${where}
          )
          SELECT * FROM ranked WHERE rn = 1
          ORDER BY ${relOrder} ${outerSort} ${dir}
          LIMIT ${limit} OFFSET ${offset}`
        : sql`
          SELECT ${selectList}${relSelect}
          ${joins}
          WHERE ${where}
          ORDER BY ${relOrder} ${innerSort} ${dir}
          LIMIT ${limit} OFFSET ${offset}`
    )) as unknown as RawAnalyzedRow[];

    return { items: rows.map(toAnalyzedEmail), total, limit, offset };
  }

  /** One analyzed email, with its task overlay. */
  async getAnalyzedEmailById(
    header: RequestHeader,
    emailId: string
  ): Promise<AnalyzedEmailRow | null> {
    const where = joinAnd(this.searchParts(header, { emailId }));

    const rows = (await this.db.execute(sql`
      SELECT
        e.id, e.thread_id, e.subject, e.body, e.from_email, e.from_name,
        e.tos, e.ccs, e.bccs,
        e.received_at, e.created_at, e.signals,
        ep.customer_id, c.name AS customer_name,
        t.id AS task_id, t.status AS task_status, t.assigned_to_id,
        CONCAT(assignee_u.first_name, ' ', assignee_u.last_name) AS assigned_to_name,
        assignee_u.email AS assigned_to_email,
        t.problem, t.resolution,
        t.completed_at, t.completed_by_id,
        CONCAT(completed_u.first_name, ' ', completed_u.last_name) AS completed_by_name,
        t.created_at AS task_created_at
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      LEFT  JOIN tasks t ON t.email_id = e.id
      LEFT  JOIN users assignee_u  ON assignee_u.id  = t.assigned_to_id
      LEFT  JOIN users completed_u ON completed_u.id = t.completed_by_id
      WHERE ${where}
      LIMIT 1
    `)) as unknown as RawAnalyzedRow[];

    return rows[0] ? toAnalyzedEmail(rows[0]) : null;
  }

  /**
   * Every message in a thread, oldest first.
   *
   * Access is checked on the THREAD rather than per row: a reader allowed to see
   * the conversation sees all of it, including their own team's replies, which
   * carry no customer participant of their own and would otherwise vanish from
   * the middle of the transcript.
   */
  async getThreadEmails(header: RequestHeader, threadId: string): Promise<ThreadEmailRow[]> {
    const [allowed] = (await this.db.execute(sql`
      SELECT 1 AS ok
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      WHERE e.thread_id = ${threadId}
        AND e.tenant_id = ${header.tenantId}
        AND ep.customer_id IS NOT NULL
        AND ${this.accessScope(header)}
      LIMIT 1
    `)) as unknown as Array<{ ok: number }>;

    if (!allowed) return [];

    const rows = (await this.db.execute(sql`
      SELECT
        e.id, e.thread_id, e.subject, e.body,
        e.from_email, e.from_name, e.tos, e.ccs, e.bccs,
        e.received_at, e.signals, e.analysis_status
      FROM emails e
      WHERE e.thread_id = ${threadId}
        AND e.tenant_id = ${header.tenantId}
      ORDER BY e.received_at ASC
    `)) as unknown as Array<{
      id: string;
      thread_id: string;
      subject: string | null;
      body: string | null;
      from_email: string | null;
      from_name: string | null;
      tos: EmailAddress[] | null;
      ccs: EmailAddress[] | null;
      bccs: EmailAddress[] | null;
      received_at: string;
      signals: number[] | null;
      analysis_status: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      subject: r.subject,
      body: r.body,
      fromEmail: r.from_email,
      fromName: r.from_name,
      tos: r.tos ?? [],
      ccs: r.ccs ?? [],
      bccs: r.bccs ?? [],
      receivedAt: r.received_at,
      signals: r.signals ?? [],
      isAnalyzed: r.analysis_status === EmailAnalysisStatus.Completed,
    }));
  }

  /**
   * Toggle a task between Open (0) and Done (1), stamping completed_at.
   *
   * The only write in this module, and the place where crm-manager's missing
   * scoping was not merely a disclosure problem but a mutation one: it updated
   * `WHERE id = $1` with no tenant predicate at all, so a task id from any
   * tenant was fair game. Both the tenant and the caller's customer access are
   * enforced here, and a row outside them simply does not match.
   */
  async updateTaskStatus(
    header: RequestHeader,
    taskId: string,
    status: 0 | 1
  ): Promise<{ id: string; status: number; completedAt: string | null } | null> {
    const rows = (await this.db.execute(sql`
      UPDATE tasks
      SET status = ${status},
          completed_at = ${status === 1 ? sql`NOW()` : sql`NULL`},
          completed_by_id = ${status === 1 ? sql`${header.userId}` : sql`NULL`},
          updated_at = NOW()
      WHERE id = ${taskId}
        AND tenant_id = ${header.tenantId}
        AND (
          ${isAdmin(header.permissions) ? sql`true` : sql`customer_id IN (
            SELECT uac.customer_id FROM user_accessible_customers uac
            WHERE uac.user_id = ${header.userId}
          )`}
        )
      RETURNING id, status, completed_at
    `)) as unknown as Array<{ id: string; status: number; completed_at: string | null }>;

    if (rows.length === 0) return null;
    return { id: rows[0].id, status: rows[0].status, completedAt: rows[0].completed_at };
  }

  /** System roles in this tenant, for the Users drawer's role dropdown. */
  async getRoles(header: RequestHeader): Promise<Array<{ id: string; name: string }>> {
    const rows = (await this.db.execute(sql`
      SELECT id, name FROM roles
      WHERE tenant_id = ${header.tenantId}
      ORDER BY name ASC
    `)) as unknown as Array<{ id: string; name: string }>;
    return rows;
  }

  // -------------------------------------------------------------------------
  // Customers section
  // -------------------------------------------------------------------------

  /**
   * The customer list with its per-customer email aggregates.
   *
   * Customers themselves are not date-filtered — the roster does not change
   * because you narrowed the range — but their aggregate columns are, which is
   * why the date predicate lives inside the LATERAL and not in the outer WHERE.
   */
  async getCustomersList(
    header: RequestHeader,
    req: CustomerListRequest
  ): Promise<{ items: CustomerListRow[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(200, Math.max(1, req.limit ?? 50));
    const offset = Math.max(0, req.offset ?? 0);

    const custParts: SQL[] = [
      sql`c.tenant_id = ${header.tenantId}`,
      sql`c.row_status = 0`,
      this.customerScope(header, sql`c.id`),
    ];
    for (const term of searchTerms(req.search)) {
      custParts.push(sql`(
        c.name ILIKE ${term}
        OR EXISTS (
          SELECT 1 FROM customer_domains cd
          WHERE cd.customer_id = c.id AND cd.domain ILIKE ${term}
        )
      )`);
    }
    if (req.customerId) custParts.push(sql`c.id = ${req.customerId}`);
    if (req.teamMemberId) {
      custParts.push(sql`EXISTS (
        SELECT 1 FROM user_customers uc
        WHERE uc.customer_id = c.id AND uc.user_id = ${req.teamMemberId}
      )`);
    }
    const custWhere = joinAnd(custParts);

    const dateParts: SQL[] = [];
    const from = parseDayStart(req.dateFrom);
    const to = parseDayEnd(req.dateTo);
    if (from) dateParts.push(sql`e.received_at >= ${from}::timestamptz`);
    if (to) dateParts.push(sql`e.received_at <= ${to}::timestamptz`);
    const dateWhere = dateParts.length ? joinAnd(dateParts) : sql`TRUE`;

    // Sort column comes from a closed map, never from caller text.
    const sortCols: Record<string, SQL> = {
      name: sql`c.name`,
      emailCount: sql`agg.total_emails`,
      negativeCount: sql`agg.negative`,
      upsellCount: sql`agg.upsell`,
      churnCount: sql`agg.churn`,
      positiveCount: sql`agg.positive`,
      lastContactDate: sql`agg.last_contact`,
    };
    const sortCol = sortCols[req.sortBy ?? ''] ?? sql`c.name`;
    const sortDir = req.sortOrder === 'desc' ? sql`DESC NULLS LAST` : sql`ASC NULLS LAST`;

    const countRows = (await this.db.execute(sql`
      SELECT COUNT(*)::int AS count FROM customers c WHERE ${custWhere}
    `)) as unknown as Array<{ count: number }>;

    const rows = (await this.db.execute(sql`
      SELECT
        c.id   AS "id",
        c.name AS "name",
        (
          SELECT cd.domain FROM customer_domains cd
          WHERE cd.customer_id = c.id ORDER BY cd.created_at ASC LIMIT 1
        ) AS "domain",
        COALESCE(agg.total_emails, 0) AS "totalEmails",
        COALESCE(agg.positive, 0)     AS "positiveCount",
        COALESCE(agg.neutral, 0)      AS "neutralCount",
        COALESCE(agg.negative, 0)     AS "negativeCount",
        COALESCE(agg.upsell, 0)       AS "upsellCount",
        COALESCE(agg.churn, 0)        AS "churnCount",
        agg.avg_tat_days::float8      AS "avgTatDays",
        agg.last_contact              AS "lastContact"
      FROM customers c
      LEFT JOIN LATERAL (
        SELECT
          COUNT(DISTINCT e.id)::int AS total_emails,
          COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[])::int AS positive,
          COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEUTRAL}]::integer[])::int  AS neutral,
          COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[])::int AS negative,
          COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.UPSELL}]::integer[])::int AS upsell,
          COUNT(DISTINCT e.id) FILTER (
            WHERE e.signals && ARRAY[${Signal.CHURN_LOW}, ${Signal.CHURN_MEDIUM}, ${Signal.CHURN_HIGH}, ${Signal.CHURN_CRITICAL}]::integer[]
          )::int AS churn,
          AVG(EXTRACT(EPOCH FROM (e.first_reply_at - e.received_at)) / 86400.0)
            FILTER (WHERE e.first_reply_at IS NOT NULL AND e.is_customer_email = true) AS avg_tat_days,
          MAX(e.received_at) AS last_contact
        FROM emails e
        INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
        WHERE ep.customer_id = c.id
          AND e.tenant_id = ${header.tenantId}
          AND ${dateWhere}
      ) agg ON true
      WHERE ${custWhere}
      ORDER BY ${sortCol} ${sortDir}, c.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as CustomerListRow[];

    return { items: rows, total: countRows[0]?.count ?? 0, limit, offset };
  }

  /** One customer, with every domain that resolves to it. */
  async getCustomerById(
    header: RequestHeader,
    customerId: string
  ): Promise<CustomerDetail | null> {
    const rows = (await this.db.execute(sql`
      SELECT c.id, c.name, c.website, c.industry
      FROM customers c
      WHERE c.id = ${customerId}
        AND c.tenant_id = ${header.tenantId}
        AND ${this.customerScope(header, sql`c.id`)}
      LIMIT 1
    `)) as unknown as Array<{
      id: string;
      name: string | null;
      website: string | null;
      industry: string | null;
    }>;
    if (rows.length === 0) return null;

    const domainRows = (await this.db.execute(sql`
      SELECT domain FROM customer_domains
      WHERE customer_id = ${customerId}
      ORDER BY created_at ASC
    `)) as unknown as Array<{ domain: string }>;

    return {
      id: rows[0].id,
      name: rows[0].name || '(unnamed)',
      website: rows[0].website,
      industry: rows[0].industry,
      domains: domainRows.map((r) => r.domain),
    };
  }

  /** Contacts belonging to a customer. Empty list when it isn't visible. */
  async getCustomerContacts(
    header: RequestHeader,
    customerId: string
  ): Promise<ContactRow[]> {
    const rows = (await this.db.execute(sql`
      SELECT ct.id, ct.name, ct.title, ct.email, ct.phone, ct.mobile
      FROM contacts ct
      INNER JOIN customers c ON c.id = ct.customer_id
      WHERE ct.customer_id = ${customerId}
        AND ct.tenant_id = ${header.tenantId}
        AND ${this.customerScope(header, sql`c.id`)}
      ORDER BY ct.name ASC NULLS LAST
    `)) as unknown as ContactRow[];
    return rows;
  }

  /**
   * The team assigned to a customer.
   *
   * Role name resolves in three steps, because the assignment role and the
   * user's org-wide role are different things and either may be missing:
   * the well-known per-customer role UUID, then that id in `roles`, then the
   * user's primary role — so the column is never blank for someone who is on
   * the team without an explicit assignment role.
   */
  async getCustomerTeam(
    header: RequestHeader,
    customerId: string
  ): Promise<TeamMemberRow[]> {
    const rows = (await this.db.execute(sql`
      SELECT
        u.id, u.first_name, u.last_name, u.email,
        uc.role_id AS assignment_role_id,
        ar.name    AS assignment_role_name,
        u.role_id  AS primary_role_id,
        pr.name    AS primary_role_name
      FROM user_customers uc
      INNER JOIN users u ON u.id = uc.user_id
      INNER JOIN customers c ON c.id = uc.customer_id
      LEFT  JOIN roles ar ON ar.id = uc.role_id
      LEFT  JOIN roles pr ON pr.id = u.role_id
      WHERE uc.customer_id = ${customerId}
        AND c.tenant_id = ${header.tenantId}
        AND ${this.customerScope(header, sql`c.id`)}
      ORDER BY u.first_name ASC, u.last_name ASC
    `)) as unknown as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      assignment_role_id: string | null;
      assignment_role_name: string | null;
      primary_role_id: string | null;
      primary_role_name: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      roleId: r.assignment_role_id ?? r.primary_role_id,
      role:
        (r.assignment_role_id ? WELL_KNOWN_ROLE_NAMES[r.assignment_role_id] : null) ??
        r.assignment_role_name ??
        r.primary_role_name ??
        null,
      assignmentRoleId: r.assignment_role_id,
      primaryRoleId: r.primary_role_id,
    }));
  }

  /**
   * Add a team member, or change their role if they are already on the team —
   * one endpoint for both, which is what the drawer's single Save expects.
   * Returns the resulting team so the caller re-renders from server truth.
   */
  async addCustomerTeamMember(
    header: RequestHeader,
    customerId: string,
    userId: string,
    roleId: string | null
  ): Promise<TeamMemberRow[]> {
    // Both sides must belong to this tenant; a raw INSERT would happily bind a
    // foreign user to a foreign customer.
    const ok = (await this.db.execute(sql`
      SELECT 1 AS ok
      FROM customers c, users u
      WHERE c.id = ${customerId} AND c.tenant_id = ${header.tenantId}
        AND u.id = ${userId}     AND u.tenant_id = ${header.tenantId}
      LIMIT 1
    `)) as unknown as Array<{ ok: number }>;
    if (ok.length === 0) return [];

    await this.db.execute(sql`
      INSERT INTO user_customers (user_id, customer_id, role_id)
      VALUES (${userId}, ${customerId}, ${roleId})
      ON CONFLICT (user_id, customer_id) DO UPDATE SET role_id = EXCLUDED.role_id
    `);

    return this.getCustomerTeam(header, customerId);
  }

  /**
   * Roles assignable on a customer.
   *
   * These are the well-known per-customer role UUIDs, deliberately separate
   * from the system `roles` table so the Team dropdown offers "Book Keeper",
   * "Account Manager" and friends without polluting the Users drawer's
   * primary-role list.
   */
  getTeamRoles(): Array<{ id: string; name: string }> {
    return Object.entries(WELL_KNOWN_ROLE_NAMES)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // -------------------------------------------------------------------------
  // Users section
  // -------------------------------------------------------------------------

  /** The user list with reports-to and customer-assignment counts. */
  async getUsersList(
    header: RequestHeader,
    req: UserListRequest
  ): Promise<{ items: UserListRow[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(200, Math.max(1, req.limit ?? 50));
    const offset = Math.max(0, req.offset ?? 0);

    const parts: SQL[] = [
      sql`u.tenant_id = ${header.tenantId}`,
      req.status === 'inactive' ? sql`u.row_status IN (1, 2)` : sql`u.row_status = 0`,
    ];
    for (const term of searchTerms(req.search)) {
      parts.push(sql`(
        u.first_name ILIKE ${term}
        OR u.last_name ILIKE ${term}
        OR u.email ILIKE ${term}
        OR r.name ILIKE ${term}
      )`);
    }
    const where = joinAnd(parts);

    const sortCols: Record<string, SQL> = {
      name: sql`u.first_name`,
      role: sql`r.name`,
      lastLoginAt: sql`u.last_login_at`,
    };
    const sortCol = sortCols[req.sortBy ?? ''] ?? sql`u.first_name`;
    const sortDir = req.sortOrder === 'desc' ? sql`DESC NULLS LAST` : sql`ASC NULLS LAST`;

    const countRows = (await this.db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE ${where}
    `)) as unknown as Array<{ count: number }>;

    const rows = (await this.db.execute(sql`
      SELECT
        u.id            AS "id",
        u.first_name    AS "firstName",
        u.last_name     AS "lastName",
        u.email         AS "email",
        u.can_login     AS "canLogin",
        u.timezone      AS "timezone",
        u.last_login_at AS "lastLoginAt",
        u.row_status    AS "rowStatus",
        r.id            AS "roleId",
        r.name          AS "role",
        (SELECT COUNT(*)::int FROM user_managers  um WHERE um.user_id = u.id) AS "reportsToCount",
        (SELECT COUNT(*)::int FROM user_customers uc WHERE uc.user_id = u.id) AS "customerCount"
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE ${where}
      ORDER BY ${sortCol} ${sortDir}, u.last_name ASC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as Array<Omit<UserListRow, 'statusLabel'>>;

    return {
      items: rows.map((r) => ({ ...r, statusLabel: userStatusLabel(r.rowStatus) })),
      total: countRows[0]?.count ?? 0,
      limit,
      offset,
    };
  }

  /** One user, with managers and customer assignments for the edit drawer. */
  async getUserById(header: RequestHeader, userId: string): Promise<UserDetail | null> {
    const rows = (await this.db.execute(sql`
      SELECT
        u.id            AS "id",
        u.first_name    AS "firstName",
        u.last_name     AS "lastName",
        u.email         AS "email",
        u.can_login     AS "canLogin",
        u.timezone      AS "timezone",
        u.last_login_at AS "lastLoginAt",
        u.row_status    AS "rowStatus",
        r.id            AS "roleId",
        r.name          AS "role"
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = ${userId} AND u.tenant_id = ${header.tenantId}
      LIMIT 1
    `)) as unknown as Array<Omit<UserDetail, 'statusLabel' | 'managers' | 'customerAssignments'>>;
    if (rows.length === 0) return null;

    const managers = (await this.db.execute(sql`
      SELECT u2.id AS "id", u2.first_name AS "firstName",
             u2.last_name AS "lastName", u2.email AS "email"
      FROM user_managers um
      INNER JOIN users u2 ON u2.id = um.manager_id
      WHERE um.user_id = ${userId} AND u2.tenant_id = ${header.tenantId}
      ORDER BY u2.first_name ASC, u2.last_name ASC
    `)) as unknown as UserDetail['managers'];

    const customerAssignments = (await this.db.execute(sql`
      SELECT uc.customer_id AS "customerId", c.name AS "customerName",
             uc.role_id AS "roleId", r.name AS "roleName"
      FROM user_customers uc
      INNER JOIN customers c ON c.id = uc.customer_id
      LEFT  JOIN roles r ON r.id = uc.role_id
      WHERE uc.user_id = ${userId} AND c.tenant_id = ${header.tenantId}
      ORDER BY c.name ASC
    `)) as unknown as UserDetail['customerAssignments'];

    return {
      ...rows[0],
      statusLabel: userStatusLabel(rows[0].rowStatus),
      managers,
      customerAssignments,
    };
  }

  /**
   * Patch a user. Only supplied fields are written, so a drawer that submits a
   * partial form cannot blank out what it didn't show.
   *
   * `managerIds` and `customerAssignments` are replace-the-whole-list, which is
   * what lets the drawer save with one call instead of N small mutations.
   */
  async updateUser(
    header: RequestHeader,
    userId: string,
    patch: UserPatch
  ): Promise<UserDetail | null> {
    const exists = (await this.db.execute(sql`
      SELECT 1 AS ok FROM users
      WHERE id = ${userId} AND tenant_id = ${header.tenantId} LIMIT 1
    `)) as unknown as Array<{ ok: number }>;
    if (exists.length === 0) return null;

    const sets: SQL[] = [];
    if (typeof patch.firstName === 'string') sets.push(sql`first_name = ${patch.firstName}`);
    if (typeof patch.lastName === 'string') sets.push(sql`last_name = ${patch.lastName}`);
    if (patch.roleId === null || typeof patch.roleId === 'string') {
      sets.push(sql`role_id = ${patch.roleId || null}`);
    }
    if (typeof patch.timezone === 'string') sets.push(sql`timezone = ${patch.timezone}`);
    if (typeof patch.canLogin === 'boolean') sets.push(sql`can_login = ${patch.canLogin}`);
    if (typeof patch.rowStatus === 'number') sets.push(sql`row_status = ${patch.rowStatus}`);

    if (sets.length > 0) {
      sets.push(sql`updated_at = NOW()`);
      await this.db.execute(sql`
        UPDATE users SET ${sql.join(sets, sql`, `)}
        WHERE id = ${userId} AND tenant_id = ${header.tenantId}
      `);
    }

    if (Array.isArray(patch.managerIds)) {
      await this.db.execute(sql`DELETE FROM user_managers WHERE user_id = ${userId}`);
      for (const managerId of patch.managerIds) {
        // A user managing themselves would violate chk_no_self_manager.
        if (!managerId || managerId === userId) continue;
        await this.db.execute(sql`
          INSERT INTO user_managers (user_id, manager_id)
          SELECT ${userId}, ${managerId}
          WHERE EXISTS (
            SELECT 1 FROM users WHERE id = ${managerId} AND tenant_id = ${header.tenantId}
          )
          ON CONFLICT DO NOTHING
        `);
      }
    }

    if (Array.isArray(patch.customerAssignments)) {
      await this.db.execute(sql`DELETE FROM user_customers WHERE user_id = ${userId}`);
      for (const assignment of patch.customerAssignments) {
        if (!assignment?.customerId) continue;
        await this.db.execute(sql`
          INSERT INTO user_customers (user_id, customer_id, role_id)
          SELECT ${userId}, ${assignment.customerId}, ${assignment.roleId || null}
          WHERE EXISTS (
            SELECT 1 FROM customers
            WHERE id = ${assignment.customerId} AND tenant_id = ${header.tenantId}
          )
          ON CONFLICT (user_id, customer_id) DO UPDATE SET role_id = EXCLUDED.role_id
        `);
      }
    }

    return this.getUserById(header, userId);
  }

  /** Headline counts for the AI Analysis tab over a trailing window. */
  async getAnalyzedStats(
    header: RequestHeader,
    days: number
  ): Promise<{ total: number; positive: number; neutral: number; negative: number }> {
    const window = Math.min(3650, Math.max(1, days));
    const where = joinAnd(this.baseParts(header));

    const rows = (await this.db.execute(sql`
      SELECT
        COUNT(DISTINCT e.id)::int AS total,
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[])::int AS positive,
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEUTRAL}]::integer[])::int  AS neutral,
        COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[])::int AS negative
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      WHERE ${where}
        AND e.received_at >= NOW() - (${window} || ' days')::interval
    `)) as unknown as Array<{
      total: number;
      positive: number;
      neutral: number;
      negative: number;
    }>;

    return {
      total: rows[0]?.total ?? 0,
      positive: rows[0]?.positive ?? 0,
      neutral: rows[0]?.neutral ?? 0,
      negative: rows[0]?.negative ?? 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Types and small helpers
// ---------------------------------------------------------------------------

export interface DashboardFilters {
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  teamMemberId?: string;
}

/**
 * Roles assignable to a user *on a customer*, as fixed UUIDs.
 *
 * Carried over from crm-manager verbatim. These are not rows in `roles` — they
 * are a separate vocabulary the main app also uses, and the Team column reads
 * them back through this map so its labels match what the web app shows.
 */
const WELL_KNOWN_ROLE_NAMES: Record<string, string> = {
  '550e8400-e29b-41d4-a716-446655440001': 'Account Manager',
  '550e8400-e29b-41d4-a716-446655440002': 'Controller',
  '550e8400-e29b-41d4-a716-446655440003': 'Book Keeper',
  '550e8400-e29b-41d4-a716-446655440004': 'Accountant',
  '550e8400-e29b-41d4-a716-446655440005': 'Sr Controller',
  '550e8400-e29b-41d4-a716-446655440006': 'Sales Person',
};

const USER_STATUS_LABELS: Record<number, string> = {
  0: 'Active',
  1: 'Inactive',
  2: 'Archived',
};

function userStatusLabel(rowStatus: number | null): string {
  return (rowStatus === null ? undefined : USER_STATUS_LABELS[rowStatus]) ?? 'Unknown';
}

export interface CustomerListRequest {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  teamMemberId?: string;
  sortBy?: string;
  sortOrder?: string;
  limit?: number;
  offset?: number;
}

export interface CustomerListRow {
  id: string;
  name: string | null;
  domain: string | null;
  totalEmails: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  upsellCount: number;
  churnCount: number;
  avgTatDays: number | null;
  lastContact: string | null;
}

export interface CustomerDetail {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  domains: string[];
}

export interface ContactRow {
  id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
}

export interface TeamMemberRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  roleId: string | null;
  role: string | null;
  assignmentRoleId: string | null;
  primaryRoleId: string | null;
}

export interface UserListRequest {
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: string;
  limit?: number;
  offset?: number;
}

export interface UserListRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  canLogin: boolean;
  timezone: string | null;
  lastLoginAt: string | null;
  rowStatus: number;
  statusLabel: string;
  roleId: string | null;
  role: string | null;
  reportsToCount: number;
  customerCount: number;
}

export interface UserDetail {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  canLogin: boolean;
  timezone: string | null;
  lastLoginAt: string | null;
  rowStatus: number;
  statusLabel: string;
  roleId: string | null;
  role: string | null;
  managers: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  }>;
  customerAssignments: Array<{
    customerId: string;
    customerName: string | null;
    roleId: string | null;
    roleName: string | null;
  }>;
}

export interface UserPatch {
  firstName?: string;
  lastName?: string;
  roleId?: string | null;
  timezone?: string;
  canLogin?: boolean;
  rowStatus?: number;
  managerIds?: string[];
  customerAssignments?: Array<{ customerId: string; roleId?: string | null }>;
}

/** One row of the Recent Escalations table: an open escalation task. */
export interface RecentEscalationRow {
  taskId: string;
  createdAt: string;
  customerId: string;
  customerName: string | null;
  subject: string;
  assignedToName: string | null;
}

/**
 * Thread-shaped, unlike RecentEscalationRow: the Important Escalations tile
 * draws one bar per thread whose length is `messageCount` relative to the
 * longest chain in the set, labelled with the thread's first/last activity.
 */
export interface ImportantEscalationRow {
  threadId: string;
  emailId: string;
  customerId: string;
  customerName: string | null;
  subject: string | null;
  firstAt: string;
  lastAt: string;
  durationDays: number;
  messageCount: number;
}

/** One row of the Most Dissatisfied Customers tile: a share, plus its terms. */
export interface MostEscalatedRow {
  customerId: string;
  customerName: string | null;
  total: number;
  negative: number;
  ratio: number;
}

export interface SentimentTrendRow {
  month: string;
  total: number;
  positive: number;
  negative: number;
}

export interface VolumeTrendRow {
  day: string;
  total: number;
}

export interface TeamResponsivenessRow {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  replies: number;
  averageHours: number | null;
  slowestHours: number | null;
}

export interface TatMetricRow {
  customerId: string;
  customerName: string | null;
  onePlusDays: number;
  twoPlusDays: number;
  threePlusDays: number;
  fivePlusDays: number;
  sixPlusDays: number;
}

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface AnalyzedSearchRequest {
  emailId?: string;
  search?: string;
  signal?: string;
  churnLevel?: string;
  status?: string;
  assignedToId?: string;
  customerId?: string;
  teamMemberId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: string;
  groupByThread?: boolean;
  limit?: number;
  offset?: number;
}

export interface AnalyzedEmailRow {
  id: string;
  threadId: string;
  subject: string | null;
  body: string | null;
  fromEmail: string | null;
  fromName: string | null;
  tos: EmailAddress[];
  ccs: EmailAddress[];
  bccs: EmailAddress[];
  receivedAt: string;
  signals: number[];
  customerId: string | null;
  customerName: string | null;
  taskId: string | null;
  taskStatus: number | null;
  assignedToId: string | null;
  assignedToName: string | null;
  assignedToEmail: string | null;
  problem: string | null;
  resolution: string | null;
  completedAt: string | null;
  completedById: string | null;
  completedByName: string | null;
  taskCreatedAt: string | null;
}

export interface ThreadEmailRow {
  id: string;
  threadId: string;
  subject: string | null;
  body: string | null;
  fromEmail: string | null;
  fromName: string | null;
  tos: EmailAddress[];
  ccs: EmailAddress[];
  bccs: EmailAddress[];
  receivedAt: string;
  signals: number[];
  isAnalyzed: boolean;
}

/** The snake_case shape Postgres hands back for the analyzed-email queries. */
interface RawAnalyzedRow {
  id: string;
  thread_id: string;
  subject: string | null;
  body: string | null;
  from_email: string | null;
  from_name: string | null;
  tos: EmailAddress[] | null;
  ccs: EmailAddress[] | null;
  bccs: EmailAddress[] | null;
  received_at: string;
  signals: number[] | null;
  customer_id: string | null;
  customer_name: string | null;
  task_id: string | null;
  task_status: number | null;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  assigned_to_email: string | null;
  problem: string | null;
  resolution: string | null;
  completed_at: string | null;
  completed_by_id: string | null;
  completed_by_name: string | null;
  task_created_at: string | null;
}

/**
 * Row → API shape. Kept identical to crm-manager's `toAnalyzedEmail` because the
 * ported AI Analysis UI reads these exact field names.
 */
function toAnalyzedEmail(r: RawAnalyzedRow): AnalyzedEmailRow {
  return {
    id: r.id,
    threadId: r.thread_id,
    subject: r.subject,
    body: r.body,
    fromEmail: r.from_email,
    fromName: r.from_name,
    tos: r.tos ?? [],
    ccs: r.ccs ?? [],
    bccs: r.bccs ?? [],
    receivedAt: r.received_at,
    signals: r.signals ?? [],
    customerId: r.customer_id,
    customerName: r.customer_name,
    taskId: r.task_id,
    taskStatus: r.task_status,
    assignedToId: r.assigned_to_id,
    assignedToName: nameOrNull(r.assigned_to_name),
    assignedToEmail: r.assigned_to_email,
    problem: r.problem,
    resolution: r.resolution,
    completedAt: r.completed_at,
    completedById: r.completed_by_id,
    completedByName: nameOrNull(r.completed_by_name),
    taskCreatedAt: r.task_created_at,
  };
}

/** CONCAT of two NULL names yields " ", which is not a name. */
function nameOrNull(s: string | null): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed === '' ? null : trimmed;
}

/** Sentiment / signal filter for the AI Analysis list. */
function signalFilter(signal: string): SQL | null {
  switch (signal) {
    case 'positive':
      return sql`e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[]`;
    case 'negative':
      return sql`e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]`;
    case 'neutral':
      return sql`e.signals @> ARRAY[${Signal.SENTIMENT_NEUTRAL}]::integer[]`;
    case 'upsell':
      return sql`e.signals @> ARRAY[${Signal.UPSELL}]::integer[]`;
    case 'churn':
      return sql`e.signals && ARRAY[${Signal.CHURN_LOW}, ${Signal.CHURN_MEDIUM}, ${Signal.CHURN_HIGH}, ${Signal.CHURN_CRITICAL}]::integer[]`;
    default:
      return null;
  }
}

function churnLevelFilter(level: string): SQL | null {
  switch (level) {
    case 'low':
      return sql`e.signals @> ARRAY[${Signal.CHURN_LOW}]::integer[]`;
    case 'medium':
      return sql`e.signals @> ARRAY[${Signal.CHURN_MEDIUM}]::integer[]`;
    case 'high':
      return sql`e.signals @> ARRAY[${Signal.CHURN_HIGH}]::integer[]`;
    case 'critical':
      return sql`e.signals @> ARRAY[${Signal.CHURN_CRITICAL}]::integer[]`;
    case 'any':
      return sql`e.signals && ARRAY[${Signal.CHURN_LOW}, ${Signal.CHURN_MEDIUM}, ${Signal.CHURN_HIGH}, ${Signal.CHURN_CRITICAL}]::integer[]`;
    default:
      return null;
  }
}

/** Combine fragments with AND. Mirrors the ported service's `andAll`. */
function joinAnd(parts: SQL[]): SQL {
  return sql.join(parts, sql` AND `);
}

/** Terms are capped so a pathological query can't fan out into 50 ILIKEs. */
const MAX_SEARCH_TERMS = 6;

/**
 * Split a query into ILIKE patterns — one per whitespace-separated word.
 *
 * `%` and `_` are escaped rather than passed through. They are LIKE wildcards,
 * so a literal search for "50%" or "Q1_report" previously matched far more than
 * the reader asked for — "50%" in particular matched every row on earth. The
 * default LIKE escape character is a backslash, hence the doubling here.
 */
function searchTerms(search?: string): string[] {
  if (!search) return [];
  return search
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TERMS)
    .map((word) => `%${word.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
}

/** Start of the given day, UTC. Returns null for empty/invalid input. */
function parseDayStart(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** End of the given day, UTC, so a `to` of 2026-08-05 includes that whole day. */
function parseDayEnd(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}
