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
    viewer: { userId: string; isAdmin: boolean },
  ): Promise<AccountContext> {
    const clean = domain.trim().toLowerCase();
    if (!clean.includes('.')) return EMPTY;

    // Non-admins are restricted to their accessible customers. Same subquery the
    // customers service uses, so the two cannot drift apart.
    const accessFilter = viewer.isAdmin
      ? sql``
      : sql`AND c.id IN (SELECT uac.customer_id FROM user_accessible_customers uac WHERE uac.user_id = ${viewer.userId})`;

    const rows = await this.db.execute(sql`
      SELECT c.id, c.name
      FROM customer_domains cd
      JOIN customers c ON c.id = cd.customer_id
      WHERE cd.tenant_id = ${tenantId} AND lower(cd.domain) = ${clean}
      ${accessFilter}
      LIMIT 1
    `);
    const customer = (rows as unknown as Array<{ id: string; name: string }>)[0];
    if (!customer) return EMPTY;

    const [stats, tasks, concerns] = await Promise.all([
      this.stats(tenantId, customer.id),
      this.openTasks(tenantId, customer.id),
      this.priorConcerns(tenantId, customer.id),
    ]);

    return {
      found: true,
      customerId: customer.id,
      name: customer.name,
      ...stats,
      openTasks: tasks,
      negativeCount: concerns.total,
      priorConcerns: concerns.recent,
    };
  }

  private async stats(tenantId: string, customerId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        COUNT(*)::int AS messages,
        COUNT(DISTINCT e.thread_id)::int AS threads,
        MIN(e.received_at)::date::text AS first_seen,
        MAX(e.received_at)::date::text AS last_seen
      FROM email_participants p
      JOIN emails e ON e.id = p.email_id
      WHERE p.tenant_id = ${tenantId} AND p.customer_id = ${customerId}
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

  /** tasks.status is a smallint enum; anything not the terminal state is open. */
  private async openTasks(tenantId: string, customerId: string): Promise<number> {
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS n FROM tasks
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND status <> 2
    `);
    return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  }

  /**
   * Past negative readings, deduplicated by reason. The same complaint often
   * appears once per message in a thread, and three identical rows read as three
   * separate problems when they are one.
   */
  private async priorConcerns(tenantId: string, customerId: string) {
    const rows = await this.db.execute(sql`
      SELECT e.received_at::date::text AS when, a.reasoning
      FROM email_analyses a
      JOIN emails e ON e.id = a.email_id
      JOIN email_participants p ON p.email_id = e.id
      WHERE a.tenant_id = ${tenantId}
        AND p.customer_id = ${customerId}
        AND a.analysis_type = 'sentiment'
        AND a.sentiment_value = 'negative'
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
