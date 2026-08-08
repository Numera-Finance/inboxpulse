/**
 * Local dev backend for the Numera AI Analysis inbox extension.
 *
 * Mirrors the SQL behind the CRM "AI Analysis" tab so the extension can show
 * the same emails (joined to the sender's customer, optionally to a task)
 * without touching the user's Gmail account.
 *
 * Endpoints:
 *   POST /api/emails/analyzed/search   -> { items, total, limit, offset }
 *   GET  /api/emails/analyzed/:emailId -> AnalyzedEmail | 404
 *   GET  /api/health                   -> { status, tenantScoped }
 *
 * Tenant scoping:
 *   - If TENANT_ID is set in .env, queries are scoped to that tenant.
 *   - If TENANT_ID is unset, queries return rows across all tenants.
 *   - Per-user access control (user_accessible_customers) is intentionally
 *     skipped: this is a single-developer tool, not a multi-user server.
 */

require('dotenv').config();

const http = require('http');
const url = require('url');
const postgres = require('postgres');
const fs = require('fs');

// Signal integer codes — mirror of packages/shared/src/types/analysis.ts in the CRM repo.
const Signal = {
  SENTIMENT_POSITIVE: 1,
  SENTIMENT_NEGATIVE: 2,
  SENTIMENT_NEUTRAL: 3,
  UPSELL: 20,
  CHURN_LOW: 30,
  CHURN_MEDIUM: 31,
  CHURN_HIGH: 32,
  CHURN_CRITICAL: 33,
};

const EMAIL_ANALYSIS_STATUS_COMPLETED = 3;
const TENANT_ID = process.env.TENANT_ID || null;
const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

// Internal (team) email domains. For reply-time math, the sender is classified
// purely by the domain of its from_email: anyone on one of these domains is a
// team member, everyone else is a customer. This replaces the unreliable
// is_customer_email flag / participant type — the whole of mytaxfiler.com was
// flagged as *customer*, and some genuine team replies had no participant row
// at all. Override via TEAM_EMAIL_DOMAINS in .env (comma-separated).
const TEAM_EMAIL_DOMAINS = (process.env.TEAM_EMAIL_DOMAINS || 'mytaxfiler.com,mystartupcfo.com')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

// The `user_customers.role_id` column stores well-known seed UUIDs that
// the main InboxPulse app maps to display names via a hardcoded constants
// file (the `roles` table here only has Administrator/Manager/User and
// doesn't carry job titles like "Book Keeper"). This mirror is what makes
// the Customers > Team column non-empty for everyone.
const WELL_KNOWN_ROLE_NAMES = {
  '550e8400-e29b-41d4-a716-446655440001': 'Account Manager',
  '550e8400-e29b-41d4-a716-446655440002': 'Controller',
  '550e8400-e29b-41d4-a716-446655440003': 'Book Keeper',
  '550e8400-e29b-41d4-a716-446655440004': 'Accountant',
  '550e8400-e29b-41d4-a716-446655440005': 'Sr Controller',
  '550e8400-e29b-41d4-a716-446655440006': 'Sales Person',
};

// ---------------------------------------------------------------------------
// Database connection (supports plain Postgres or Cloud SQL mTLS)
// ---------------------------------------------------------------------------

/**
 * Read a PEM from either an inline env var or a file path.
 *
 * Cloud Run injects certs as inline PEM through Secret Manager; local dev
 * points at files under ./certs. Mirrors packages/database/src/db.ts so both
 * services resolve credentials the same way.
 */
function readCert(inlineVar, pathVar) {
  const inline = process.env[inlineVar];
  if (inline) return inline;

  const filePath = process.env[pathVar];
  if (filePath && fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');

  return undefined;
}

function createDatabaseConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const ca = readCert('CLOUDSQL_SERVER_CA', 'CLOUDSQL_SERVER_CA_PATH');
  const cert = readCert('CLOUDSQL_CLIENT_CERT', 'CLOUDSQL_CLIENT_CERT_PATH');
  const key = readCert('CLOUDSQL_CLIENT_KEY', 'CLOUDSQL_CLIENT_KEY_PATH');

  const allCertsPresent = Boolean(ca && cert && key);

  // This is a single-developer tool that often shares a Cloud SQL instance
  // with the real app, so keep a small footprint: a modest pool, and — most
  // importantly — an idle timeout so connections are handed back to Postgres
  // instead of being held open forever. Without idle_timeout the default pool
  // pins up to 10 slots permanently, which can exhaust max_connections.
  const poolOpts = {
    max: parseInt(process.env.DB_POOL_MAX || '5', 10),
    idle_timeout: parseInt(process.env.DB_IDLE_TIMEOUT || '20', 10), // seconds
    max_lifetime: parseInt(process.env.DB_MAX_LIFETIME || '300', 10), // seconds
    connect_timeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '15', 10), // seconds
  };

  if (allCertsPresent) {
    const sanitize = (s) => s
      .replace(/^﻿/, '')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/\r\n?|\n/g, '\n')
      .trim() + '\n';

    console.log('[server] using mTLS certs (verify-ca)');
    return postgres(databaseUrl, {
      ...poolOpts,
      ssl: {
        rejectUnauthorized: true,
        ca: sanitize(ca),
        cert: sanitize(cert),
        key: sanitize(key),
        // Cloud SQL's server cert SAN is the instance's *.sql.goog name, which
        // doesn't match the IP we dial. Verify the chain but skip hostname
        // checking — equivalent to sslmode=verify-ca.
        checkServerIdentity: () => undefined,
      },
    });
  }
  return postgres(databaseUrl, poolOpts);
}

const db = createDatabaseConnection();

// ---------------------------------------------------------------------------
// Signal filter — mirror of repository.ts:getSignalFilterCondition
// ---------------------------------------------------------------------------

function signalFilter(signal) {
  switch (signal) {
    case 'positive': return db`e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[]`;
    case 'negative': return db`e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]`;
    case 'neutral':  return db`e.signals @> ARRAY[${Signal.SENTIMENT_NEUTRAL}]::integer[]`;
    case 'upsell':   return db`e.signals @> ARRAY[${Signal.UPSELL}]::integer[]`;
    case 'churn':
      return db`e.signals && ARRAY[${Signal.CHURN_LOW}, ${Signal.CHURN_MEDIUM}, ${Signal.CHURN_HIGH}, ${Signal.CHURN_CRITICAL}]::integer[]`;
    default: return null;
  }
}

function churnLevelFilter(level) {
  switch (level) {
    case 'low':      return db`e.signals @> ARRAY[${Signal.CHURN_LOW}]::integer[]`;
    case 'medium':   return db`e.signals @> ARRAY[${Signal.CHURN_MEDIUM}]::integer[]`;
    case 'high':     return db`e.signals @> ARRAY[${Signal.CHURN_HIGH}]::integer[]`;
    case 'critical': return db`e.signals @> ARRAY[${Signal.CHURN_CRITICAL}]::integer[]`;
    case 'any':
      return db`e.signals && ARRAY[${Signal.CHURN_LOW}, ${Signal.CHURN_MEDIUM}, ${Signal.CHURN_HIGH}, ${Signal.CHURN_CRITICAL}]::integer[]`;
    default: return null;
  }
}

// Combine an array of SQL fragments with AND.
function andAll(parts) {
  return parts.reduce((acc, part) => db`${acc} AND ${part}`);
}

// Predicate: the email's customer has a user_customers row with this user.
// Account-ownership semantics — used by the dashboard's global scope filter.
function teamMemberPredicate(userId) {
  return db`EXISTS (
    SELECT 1 FROM user_customers uc
    WHERE uc.customer_id = ep.customer_id AND uc.user_id = ${userId}
  )`;
}

// Predicate: the team member *sent at least one email* in the thread — not
// merely addressed or cc'd on one. Internal users are recorded in
// email_participants as participant_type='user' with participant_id = users.id;
// the message they authored is the row whose direction='from'. We match that
// indexed triple and lift it to the whole thread. This is what the AI Analysis
// team-member filter (and the response-delay drill-in from the dashboard) means
// by "this member's threads": chains the member actually replied on, which also
// mirrors what the Largest Response Delays meter measures (the gap before a
// message THEY sent). Threads where they were only a recipient are excluded.
function teamMemberSenderPredicate(userId) {
  return db`e.thread_id IN (
    SELECT e_tm.thread_id
    FROM email_participants ep_tm
    INNER JOIN emails e_tm ON e_tm.id = ep_tm.email_id
    WHERE ep_tm.participant_type = 'user'
      AND ep_tm.participant_id = ${userId}
      AND ep_tm.direction = 'from'
  )`;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function buildWhereParts(req, { includeIdEquals } = {}) {
  const parts = [
    db`e.analysis_status = ${EMAIL_ANALYSIS_STATUS_COMPLETED}`,
    db`ep.customer_id IS NOT NULL`,
  ];
  if (TENANT_ID) parts.push(db`e.tenant_id = ${TENANT_ID}`);
  if (includeIdEquals) parts.push(db`e.id = ${includeIdEquals}`);

  if (req.signal && req.signal !== 'all') {
    const cond = signalFilter(req.signal);
    if (cond) parts.push(cond);
  }
  if (req.churnLevel && req.churnLevel !== 'all') {
    const cond = churnLevelFilter(req.churnLevel);
    if (cond) parts.push(cond);
  }
  if (req.status && req.status !== 'all') {
    parts.push(db`t.status = ${req.status === 'done' ? 1 : 0}`);
  }
  if (req.assignedToId) {
    if (req.assignedToId === 'unassigned') {
      parts.push(db`t.id IS NOT NULL AND t.assigned_to_id IS NULL`);
    } else {
      parts.push(db`t.assigned_to_id = ${req.assignedToId}`);
    }
  }
  if (req.customerId) parts.push(db`ep.customer_id = ${req.customerId}`);
  if (req.teamMemberId) parts.push(teamMemberSenderPredicate(req.teamMemberId));
  if (req.dateFrom)   parts.push(db`e.received_at >= ${req.dateFrom}::timestamp`);
  if (req.dateTo)     parts.push(db`e.received_at <= ${req.dateTo}::timestamp`);
  if (req.search) {
    const term = `%${req.search}%`;
    parts.push(db`(e.subject ILIKE ${term} OR e.id IN (
      SELECT ep2.email_id FROM email_participants ep2
      WHERE ep2.email ILIKE ${term} OR ep2.name ILIKE ${term}
    ))`);
  }
  return parts;
}

async function searchAnalyzedEmails(req) {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.limit ?? DEFAULT_PAGE_SIZE, 10)));
  const offset = Math.max(0, parseInt(req.offset ?? 0, 10));
  const useCreatedAt = req.sortBy === 'createdAt';
  const sortColumn = useCreatedAt ? db`e.created_at` : db`e.received_at`;
  const sortDir = req.sortOrder === 'asc' ? db`ASC` : db`DESC`;

  const where = andAll(buildWhereParts(req));

  // When groupByThread is set, collapse to one row per thread (the most
  // recent analyzed email). Used by the AI Analysis inbox so multiple
  // matching emails from the same conversation don't fragment the list.
  if (req.groupByThread) {
    const countRows = await db`
      SELECT COUNT(DISTINCT e.thread_id)::int AS count
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      LEFT  JOIN tasks t ON t.email_id = e.id
      WHERE ${where}
    `;
    const total = countRows[0]?.count ?? 0;

    const outerSortCol = useCreatedAt ? db`created_at` : db`received_at`;
    const rows = await db`
      WITH ranked AS (
        SELECT
          e.id, e.thread_id, e.subject, e.body, e.from_email, e.from_name,
          e.received_at, e.created_at, e.signals,
          ep.customer_id, c.name AS customer_name,
          t.id AS task_id, t.status AS task_status, t.assigned_to_id,
          CONCAT(assignee_u.first_name, ' ', assignee_u.last_name) AS assigned_to_name,
          assignee_u.email AS assigned_to_email,
          t.problem, t.resolution,
          t.completed_at, t.completed_by_id,
          CONCAT(completed_u.first_name, ' ', completed_u.last_name) AS completed_by_name,
          t.created_at AS task_created_at,
          ROW_NUMBER() OVER (PARTITION BY e.thread_id ORDER BY e.received_at DESC) AS rn
        FROM emails e
        INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
        INNER JOIN customers c ON c.id = ep.customer_id
        LEFT  JOIN tasks t ON t.email_id = e.id
        LEFT  JOIN users assignee_u  ON assignee_u.id  = t.assigned_to_id
        LEFT  JOIN users completed_u ON completed_u.id = t.completed_by_id
        WHERE ${where}
      )
      SELECT * FROM ranked WHERE rn = 1
      ORDER BY ${outerSortCol} ${sortDir}
      LIMIT ${limit} OFFSET ${offset}
    `;

    return { items: rows.map(toAnalyzedEmail), total, limit, offset };
  }

  const countRows = await db`
    SELECT COUNT(DISTINCT e.id)::int AS count
    FROM emails e
    INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
    INNER JOIN customers c ON c.id = ep.customer_id
    LEFT  JOIN tasks t ON t.email_id = e.id
    WHERE ${where}
  `;
  const total = countRows[0]?.count ?? 0;

  const rows = await db`
    SELECT
      e.id, e.thread_id, e.subject, e.body, e.from_email, e.from_name,
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
    ORDER BY ${sortColumn} ${sortDir}
    LIMIT ${limit} OFFSET ${offset}
  `;

  return { items: rows.map(toAnalyzedEmail), total, limit, offset };
}

async function getStats(days) {
  const safeDays = Math.max(1, Math.min(365, parseInt(days, 10) || 30));

  // Use calendar-day-aligned bounds (00:00 -> 23:59:59.999 UTC) and a
  // `received_at <= dateTo` predicate so the numbers match a search filter
  // configured with the displayed dates.
  const now = new Date();
  const dateTo = new Date(now);
  dateTo.setUTCHours(23, 59, 59, 999);
  const dateFrom = new Date(now.getTime() - safeDays * 86_400_000);
  dateFrom.setUTCHours(0, 0, 0, 0);

  const parts = [
    db`e.analysis_status = ${EMAIL_ANALYSIS_STATUS_COMPLETED}`,
    db`ep.customer_id IS NOT NULL`,
    db`e.received_at >= ${dateFrom.toISOString()}::timestamp`,
    db`e.received_at <= ${dateTo.toISOString()}::timestamp`,
  ];
  if (TENANT_ID) parts.push(db`e.tenant_id = ${TENANT_ID}`);
  const where = andAll(parts);

  // FILTER lets us collect every breakdown in a single query.
  const rows = await db`
    SELECT
      COUNT(DISTINCT e.id)::int AS total,
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[])::int AS positive,
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[])::int AS negative,
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEUTRAL}]::integer[])::int AS neutral,
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.UPSELL}]::integer[])::int AS upsell,
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals && ARRAY[${Signal.CHURN_LOW}, ${Signal.CHURN_MEDIUM}, ${Signal.CHURN_HIGH}, ${Signal.CHURN_CRITICAL}]::integer[])::int AS churn,
      COUNT(DISTINCT e.id) FILTER (WHERE t.id IS NOT NULL AND t.status = 0)::int AS open_tasks,
      COUNT(DISTINCT e.id) FILTER (WHERE t.id IS NOT NULL AND t.status = 1)::int AS done_tasks
    FROM emails e
    INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
    INNER JOIN customers c ON c.id = ep.customer_id
    LEFT  JOIN tasks t ON t.email_id = e.id
    WHERE ${where}
  `;
  const r = rows[0] || {};

  return {
    days: safeDays,
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
    total: r.total ?? 0,
    bySignal: {
      positive: r.positive ?? 0,
      negative: r.negative ?? 0,
      neutral: r.neutral ?? 0,
      upsell: r.upsell ?? 0,
      churn: r.churn ?? 0,
    },
    byStatus: {
      open: r.open_tasks ?? 0,
      done: r.done_tasks ?? 0,
    },
  };
}

async function getAnalyzedEmailById(emailId) {
  const where = andAll(buildWhereParts({}, { includeIdEquals: emailId }));

  const rows = await db`
    SELECT
      e.id, e.thread_id, e.subject, e.body, e.from_email, e.from_name,
      e.tos, e.ccs, e.bccs,
      e.received_at, e.signals,
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
  `;
  return rows[0] ? toAnalyzedEmail(rows[0]) : null;
}

function nameOrNull(s) {
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed === '' ? null : trimmed;
}

// Toggle a task between Open (0) and Done (1). When marking Done we stamp
// completed_at = NOW() so the UI's "completed" display has the right
// timestamp; reopening clears it. This is the backing call for the
// "Mark Resolved" / "Reopen" button on the AI Analysis thread view.
async function updateTaskStatus(taskId, status) {
  if (status !== 0 && status !== 1) {
    throw new Error('status must be 0 (open) or 1 (done)');
  }
  const completedAtFrag = status === 1 ? db`NOW()` : db`NULL`;
  const rows = await db`
    UPDATE tasks
    SET status        = ${status},
        completed_at  = ${completedAtFrag},
        updated_at    = NOW()
    WHERE id = ${taskId}
    RETURNING id, status, completed_at
  `;
  if (rows.length === 0) throw new Error('Task not found');
  return {
    id: rows[0].id,
    status: rows[0].status,
    completedAt: rows[0].completed_at,
  };
}

// ---------------------------------------------------------------------------
// Dashboard helpers
// ---------------------------------------------------------------------------

// Parse a YYYY-MM-DD or full ISO date string. Returns null for empty/invalid.
function parseDate(value, endOfDay) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setUTCHours(23, 59, 59, 999);
  else d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Base predicates shared by every dashboard query: tenant scope + analyzed +
// sender is a customer (mirrors buildWhereParts so KPI counts match the AI
// Analysis list).
function dashboardBaseParts() {
  const parts = [
    db`e.analysis_status = ${EMAIL_ANALYSIS_STATUS_COMPLETED}`,
    db`ep.customer_id IS NOT NULL`,
  ];
  if (TENANT_ID) parts.push(db`e.tenant_id = ${TENANT_ID}`);
  return parts;
}

// Date-range predicates against e.received_at. Pass parsed Date objects.
function dateRangeParts(dateFrom, dateTo) {
  const parts = [];
  if (dateFrom) parts.push(db`e.received_at >= ${dateFrom.toISOString()}::timestamp`);
  if (dateTo)   parts.push(db`e.received_at <= ${dateTo.toISOString()}::timestamp`);
  return parts;
}

// SQL predicate: the given from_email column belongs to a team member (its
// domain is in TEAM_EMAIL_DOMAINS). `col` is a db`` fragment naming the column,
// e.g. isTeamEmail(db`e.from_email`). A NULL/blank address is treated as a
// customer (not a team member). Used by the reply-time calculations.
function isTeamEmail(col) {
  return db`lower(split_part(${col}, '@', 2)) = ANY(${TEAM_EMAIL_DOMAINS})`;
}

// Predicates shared by every dashboard query that supports the global
// customer / team-member filters from the top bar.
function dashboardScopeParts({ customerId, teamMemberId }) {
  const parts = [];
  if (customerId)   parts.push(db`ep.customer_id = ${customerId}`);
  if (teamMemberId) parts.push(teamMemberPredicate(teamMemberId));
  return parts;
}

// Summary KPI tiles in one call so the four headline numbers refresh together.
async function getDashboardSummary({ dateFrom, dateTo, customerId, teamMemberId }) {
  const from = parseDate(dateFrom, false);
  const to   = parseDate(dateTo, true);
  const where = andAll([
    ...dashboardBaseParts(),
    ...dateRangeParts(from, to),
    ...dashboardScopeParts({ customerId, teamMemberId }),
  ]);

  // Emails analyzed + upsell open + active escalations (negative + open task)
  const emailRows = await db`
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
  `;

  // Distinct customers with any analyzed email in range (so the count moves
  // with the date filter, unlike the main app's "Total Customers" tile).
  const custRows = await db`
    SELECT COUNT(DISTINCT ep.customer_id)::int AS active_customers
    FROM emails e
    INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
    WHERE ${where}
  `;

  const e = emailRows[0] || {};
  const c = custRows[0] || {};
  return {
    customers: c.active_customers ?? 0,
    emails: e.total ?? 0,
    activeEscalations: e.active_escalations ?? 0,
    upsellOpportunities: e.upsell_opportunities ?? 0,
  };
}

// Sentiment distribution for the donut chart.
async function getSentimentDistribution({ dateFrom, dateTo, customerId, teamMemberId }) {
  const from = parseDate(dateFrom, false);
  const to   = parseDate(dateTo, true);
  const where = andAll([
    ...dashboardBaseParts(),
    ...dateRangeParts(from, to),
    ...dashboardScopeParts({ customerId, teamMemberId }),
  ]);

  const rows = await db`
    SELECT
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[])::int AS positive,
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEUTRAL}]::integer[])::int  AS neutral,
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[])::int AS negative
    FROM emails e
    INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
    WHERE ${where}
  `;
  const r = rows[0] || {};
  return {
    positive: r.positive ?? 0,
    neutral: r.neutral ?? 0,
    negative: r.negative ?? 0,
  };
}

// Last 6 months of sentiment % by month. Hard-coded to the trailing 6 months
// of the calendar (not the dateFrom/dateTo filter) — the chart is meant as a
// long-range trend.
async function getSentimentTrend() {
  const baseParts = dashboardBaseParts();
  baseParts.push(db`e.signals && ARRAY[${Signal.SENTIMENT_POSITIVE}, ${Signal.SENTIMENT_NEGATIVE}, ${Signal.SENTIMENT_NEUTRAL}]::integer[]`);
  baseParts.push(db`e.received_at >= date_trunc('month', now() - interval '5 months')`);
  const where = andAll(baseParts);

  const rows = await db`
    SELECT
      to_char(date_trunc('month', e.received_at), 'YYYY-MM') AS month,
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[])::int AS positive,
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEUTRAL}]::integer[])::int  AS neutral,
      COUNT(DISTINCT e.id) FILTER (WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[])::int AS negative
    FROM emails e
    INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1
  `;

  // Pad to a full 6-month window so the chart always has 6 x-axis bins.
  const now = new Date();
  const out = [];
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const r = byMonth.get(key);
    const pos = r?.positive ?? 0;
    const neu = r?.neutral  ?? 0;
    const neg = r?.negative ?? 0;
    const total = pos + neu + neg;
    // Keep one decimal: positives/negatives are a small share of an
    // overwhelmingly-neutral inbox, so whole percents would flatten the trend.
    const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
    out.push({
      month: key,
      positive: pct(pos),
      neutral:  pct(neu),
      negative: pct(neg),
    });
  }
  return out;
}

// Email volume & escalations, weekly, both at THREAD level so the two bars
// are like-to-like. Total = distinct threads with any email received that
// week; escalations = distinct threads with at least one negative-sentiment
// email received that week.
async function getVolumeTrend({ dateFrom, dateTo, customerId, teamMemberId }) {
  // Default to 4 weeks ending today if no filter provided.
  let to = parseDate(dateTo, true);
  let from = parseDate(dateFrom, false);
  if (!to) {
    to = new Date();
    to.setUTCHours(23, 59, 59, 999);
  }
  if (!from) {
    from = new Date(to.getTime() - 28 * 86_400_000);
    from.setUTCHours(0, 0, 0, 0);
  }

  const parts = [
    ...dashboardBaseParts(),
    ...dateRangeParts(from, to),
    ...dashboardScopeParts({ customerId, teamMemberId }),
  ];
  const where = andAll(parts);

  const rows = await db`
    SELECT
      to_char(date_trunc('week', e.received_at), 'YYYY-MM-DD') AS week_start,
      COUNT(DISTINCT e.thread_id)::int AS total_threads,
      COUNT(DISTINCT e.thread_id) FILTER (
        WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]
      )::int AS escalation_threads
    FROM emails e
    INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1
  `;

  return rows.map((r) => ({
    weekStart: r.week_start,
    totalThreads: r.total_threads,
    escalationThreads: r.escalation_threads,
  }));
}

// Simplified TAT: calendar days from received_at to first_reply_at (or now if
// no reply yet). Buckets emails by SLA breach band, grouped by customer.
async function getTatMetrics({ dateFrom, dateTo, customerId, teamMemberId }) {
  const from = parseDate(dateFrom, false);
  const to   = parseDate(dateTo, true);
  const parts = [
    db`ep.customer_id IS NOT NULL`,
    db`e.is_customer_email = true`,
  ];
  if (TENANT_ID) parts.push(db`e.tenant_id = ${TENANT_ID}`);
  parts.push(...dateRangeParts(from, to));
  parts.push(...dashboardScopeParts({ customerId, teamMemberId }));
  const where = andAll(parts);

  const rows = await db`
    WITH tat AS (
      SELECT
        ep.customer_id,
        c.name AS customer_name,
        EXTRACT(EPOCH FROM (COALESCE(e.first_reply_at, NOW()) - e.received_at)) / 86400.0 AS days
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      WHERE ${where}
    )
    SELECT
      customer_id,
      customer_name,
      COUNT(*) FILTER (WHERE days >= 1 AND days < 2)::int AS one_plus,
      COUNT(*) FILTER (WHERE days >= 2 AND days < 3)::int AS two_plus,
      COUNT(*) FILTER (WHERE days >= 3 AND days < 5)::int AS three_plus,
      COUNT(*) FILTER (WHERE days >= 5 AND days < 6)::int AS five_plus,
      COUNT(*) FILTER (WHERE days >= 6)::int               AS six_plus
    FROM tat
    WHERE days >= 1
    GROUP BY customer_id, customer_name
    ORDER BY six_plus DESC, five_plus DESC, three_plus DESC, two_plus DESC, one_plus DESC
    LIMIT 20
  `;

  return rows.map((r) => ({
    customerId: r.customer_id,
    customerName: r.customer_name,
    onePlus: r.one_plus,
    twoPlus: r.two_plus,
    threePlus: r.three_plus,
    fivePlus: r.five_plus,
    sixPlus: r.six_plus,
  }));
}

// Recent open escalation tasks for the dashboard table (one row per task).
async function getRecentEscalations({ dateFrom, dateTo, customerId, teamMemberId, limit = 8 }) {
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 8));
  const from = parseDate(dateFrom, false);
  const to   = parseDate(dateTo, true);

  const parts = [
    db`t.status = 0`,
    db`e.analysis_status = ${EMAIL_ANALYSIS_STATUS_COMPLETED}`,
    db`e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]`,
    db`ep.customer_id IS NOT NULL`,
  ];
  if (TENANT_ID) parts.push(db`e.tenant_id = ${TENANT_ID}`);
  if (from) parts.push(db`t.created_at >= ${from.toISOString()}::timestamp`);
  if (to)   parts.push(db`t.created_at <= ${to.toISOString()}::timestamp`);
  parts.push(...dashboardScopeParts({ customerId, teamMemberId }));
  const where = andAll(parts);

  const rows = await db`
    SELECT
      t.id, t.problem, t.created_at,
      c.id   AS customer_id,
      c.name AS customer_name,
      e.subject,
      CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
    FROM tasks t
    INNER JOIN emails e ON e.id = t.email_id
    INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
    INNER JOIN customers c ON c.id = ep.customer_id
    LEFT  JOIN users u ON u.id = t.assigned_to_id
    WHERE ${where}
    ORDER BY t.created_at DESC
    LIMIT ${safeLimit}
  `;

  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    subject: r.subject || r.problem || '(no subject)',
    createdAt: r.created_at,
    assignedToName: nameOrNull(r.assigned_to_name),
  }));
}

// Important escalations: threads whose MOST RECENT customer email is negative
// AND still has an open task — i.e. that latest message is itself an active
// escalation (the same negative + open-task condition the Active Escalations
// KPI counts), not merely a thread that contained a negative email at some
// earlier point and has since moved on. Ranked by the LENGTH OF THE REPLY
// CHAIN — the total number of messages in the thread (customer + team) —
// longest first, so the most drawn-out live escalations surface.
// (Sentiment code 2 is the escalation proxy because the dedicated ESCALATION
// signal (10) is never emitted in this dataset.) duration_days / first_at /
// last_at are still returned as context.
async function getImportantEscalations({ dateFrom, dateTo, customerId, teamMemberId }) {
  const from = parseDate(dateFrom, false);
  const to   = parseDate(dateTo, true);

  const baseParts = [db`ep.customer_id IS NOT NULL`];
  if (TENANT_ID) baseParts.push(db`e.tenant_id = ${TENANT_ID}`);
  baseParts.push(...dashboardScopeParts({ customerId, teamMemberId }));
  const baseWhere = andAll(baseParts);

  // The qualifying condition is on the thread's latest customer email (`l`):
  // it must be negative and carry an open task. last_at (= that email's time)
  // is what the dashboard date range scopes on.
  const finalParts = [
    db`l.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]`,
    db`l.task_id IS NOT NULL`,
    db`l.task_status = 0`,
  ];
  if (from) finalParts.push(db`l.last_at >= ${from.toISOString()}::timestamp`);
  if (to)   finalParts.push(db`l.last_at <= ${to.toISOString()}::timestamp`);
  const finalWhere = andAll(finalParts);

  const rows = await db`
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
      WHERE ${baseWhere}
    ),
    latest AS (
      -- One row per thread: its most recent customer email, carrying that
      -- email's signals + task status and the thread's first/last timestamps.
      SELECT * FROM ranked WHERE rn = 1
    )
    SELECT
      l.thread_id,
      l.first_at,
      l.last_at,
      EXTRACT(EPOCH FROM (l.last_at - l.first_at)) / 86400.0 AS duration_days,
      c.id   AS customer_id,
      c.name AS customer_name,
      th.subject AS thread_subject,
      l.email_id AS email_id,
      -- Full length of the reply chain: every email sharing this thread_id,
      -- customer and team alike (no customer_id / analysis filter), matching
      -- what the thread view renders. This is the ranking key.
      (
        SELECT COUNT(*)::int
        FROM emails e_all
        WHERE e_all.thread_id = l.thread_id
          ${TENANT_ID ? db`AND e_all.tenant_id = ${TENANT_ID}` : db``}
      ) AS message_count
    FROM latest l
    INNER JOIN customers     c  ON c.id  = l.customer_id
    INNER JOIN email_threads th ON th.id = l.thread_id
    WHERE ${finalWhere}
    ORDER BY message_count DESC, duration_days DESC
    LIMIT 4
  `;

  return rows.map((r) => ({
    threadId: r.thread_id,
    emailId: r.email_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    subject: r.thread_subject,
    firstAt: r.first_at,
    lastAt: r.last_at,
    durationDays: Number(r.duration_days),
    messageCount: Number(r.message_count),
  }));
}

// Most escalated customers: customers with > 10 analyzed emails in the date
// range, ranked by ratio of negative-sentiment emails to total. Top 4.
async function getMostEscalatedCustomers({ dateFrom, dateTo, customerId, teamMemberId }) {
  const from = parseDate(dateFrom, false);
  const to   = parseDate(dateTo, true);
  const where = andAll([
    ...dashboardBaseParts(),
    ...dateRangeParts(from, to),
    ...dashboardScopeParts({ customerId, teamMemberId }),
  ]);

  const rows = await db`
    SELECT
      ep.customer_id,
      c.name AS customer_name,
      COUNT(DISTINCT e.id)::int AS total,
      COUNT(DISTINCT e.id) FILTER (
        WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]
      )::int AS negative
    FROM emails e
    INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
    INNER JOIN customers c ON c.id = ep.customer_id
    WHERE ${where}
    GROUP BY ep.customer_id, c.name
    HAVING COUNT(DISTINCT e.id) > 10
    ORDER BY (COUNT(DISTINCT e.id) FILTER (
      WHERE e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]
    )::numeric / COUNT(DISTINCT e.id)) DESC,
    negative DESC
    LIMIT 4
  `;

  return rows.map((r) => ({
    customerId: r.customer_id,
    customerName: r.customer_name,
    total: r.total,
    negative: r.negative,
    ratio: r.total > 0 ? r.negative / r.total : 0,
  }));
}

// Churn level distribution: count of distinct threads in the date range
// that contain each churn signal. Used by the "Churn Level" dashboard
// tile that replaces the old "Please Examine Opportunity" card.
async function getChurnLevelCounts({ dateFrom, dateTo, customerId, teamMemberId }) {
  const from = parseDate(dateFrom, false);
  const to   = parseDate(dateTo, true);
  const where = andAll([
    ...dashboardBaseParts(),
    ...dateRangeParts(from, to),
    ...dashboardScopeParts({ customerId, teamMemberId }),
  ]);

  const rows = await db`
    SELECT
      COUNT(DISTINCT e.thread_id) FILTER (WHERE e.signals @> ARRAY[${Signal.CHURN_LOW}]::integer[])::int      AS low,
      COUNT(DISTINCT e.thread_id) FILTER (WHERE e.signals @> ARRAY[${Signal.CHURN_MEDIUM}]::integer[])::int   AS medium,
      COUNT(DISTINCT e.thread_id) FILTER (WHERE e.signals @> ARRAY[${Signal.CHURN_HIGH}]::integer[])::int     AS high,
      COUNT(DISTINCT e.thread_id) FILTER (WHERE e.signals @> ARRAY[${Signal.CHURN_CRITICAL}]::integer[])::int AS critical
    FROM emails e
    INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
    WHERE ${where}
  `;
  const r = rows[0] || {};
  return {
    low:      r.low      ?? 0,
    medium:   r.medium   ?? 0,
    high:     r.high     ?? 0,
    critical: r.critical ?? 0,
  };
}

// Log-spaced histogram buckets for response-delay distributions (in days).
// HIST_EDGES are the bucket lower bounds fed to Postgres `width_bucket`, so an
// operand < the first edge lands in bucket 0 and one >= the last edge lands in
// the final "overflow" bucket. Response times are perceived multiplicatively
// (5m→1h feels like 1d→1w), so the ~doubling log spacing keeps the heavy right
// skew readable where equal-width linear bins would collapse it into one bar.
// HIST_LABELS is the presentation contract shared with the dashboard client;
// keep it aligned 1:1 with the buckets width_bucket produces (edges.length + 1).
const HIST_EDGES = [
  15 / 1440,   // 15m
  30 / 1440,   // 30m
  60 / 1440,   // 1h
  120 / 1440,  // 2h
  240 / 1440,  // 4h
  480 / 1440,  // 8h
  1,           // 1d
  2,           // 2d
  4,           // 4d
];
const HIST_LABELS = ['<15m', '15–30m', '30m–1h', '1–2h', '2–4h', '4–8h', '8h–1d', '1–2d', '2–4d', '4d+'];
const HIST_BUCKET_COUNT = HIST_LABELS.length; // edges.length + 1 = 10

// Team responsiveness — BOTH dashboard reply-time meters from a single scan:
//   overall:   aggregate stats (avg / median / max / count) + a histogram of
//              every counted response delay, and
//   members:   the up-to-five members (>10 responses) with the highest MEDIAN
//              delay, each with its own delay histogram on the same buckets.
// They share the identical thread walk, so computing them together halves the
// work and saves the dashboard a whole round-trip / pooled connection.
//
// The method is deliberately crude and thread-local, sidestepping the forward /
// reply / quoted-chain tangle: within each thread we order every email by time
// and walk the CONSECUTIVE pairs — whenever a customer email is immediately
// followed by a team email, that time gap is one "response". A response can be a
// reply OR a forward, because the sender is classified purely by email domain
// (isTeamEmail / TEAM_EMAIL_DOMAINS), never by reply headers we don't have.
//
// The date range scopes which threads are relevant (an analyzed customer email
// received in range, matching the global scope filters) AND requires the
// responding team email itself to fall in range. `overall` counts every such
// response (including team senders we can't match to a user); `members` counts
// only responses attributable to a users row, keeps those with MORE THAN 10,
// and returns the five with the highest MEDIAN gap (median, not mean, so a
// single multi-week outlier can't crown a member who is usually prompt).
//
// NOTE: `overall.avgDays` is a mean over a right-skewed distribution (a few
// multi-week gaps), so it reads higher than the typical wait — which is exactly
// why we surface `medianDays` and the histogram alongside it.
async function getTeamResponsiveness({ dateFrom, dateTo, customerId, teamMemberId }) {
  const from = parseDate(dateFrom, false);
  const to   = parseDate(dateTo, true);

  const threadWhere = andAll([
    ...dashboardBaseParts(),
    ...dateRangeParts(from, to),
    ...dashboardScopeParts({ customerId, teamMemberId }),
  ]);

  // We only ever pair up to the end of the range (a counted team reply must be
  // <= dateTo, and can't be the "prev" of one either), so trimming the thread's
  // tail here keeps the window scan proportional to the range, not all history.
  const teParts = [db`e.thread_id IN (SELECT thread_id FROM thread_set)`];
  if (to) teParts.push(db`e.received_at <= ${to.toISOString()}::timestamp`);
  const teWhere = andAll(teParts);

  // A gap counts only when a customer email (prev) is immediately followed by a
  // team email (current) whose timestamp falls in the date range.
  const gapWhere = andAll([
    db`prev_is_team = false`,
    db`is_team = true`,
    ...(from ? [db`received_at >= ${from.toISOString()}::timestamp`] : []),
    ...(to   ? [db`received_at <= ${to.toISOString()}::timestamp`]   : []),
  ]);

  const rows = await db`
    WITH thread_set AS (
      SELECT DISTINCT e.thread_id
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      WHERE ${threadWhere}
    ),
    -- One row per lowercased address → a single user id. Built once (~1.5k users)
    -- and hash-joined below, instead of a per-email correlated scan of users.
    -- DISTINCT ON keeps it single-valued even if the same address exists under
    -- more than one tenant (we run unscoped when TENANT_ID is unset).
    user_by_email AS (
      SELECT DISTINCT ON (lower(email)) lower(email) AS lemail, id AS uid
      FROM users
      ORDER BY lower(email), id
    ),
    thread_emails AS (
      SELECT e.id, e.thread_id, e.received_at,
             ${isTeamEmail(db`e.from_email`)} AS is_team,
             ube.uid AS from_uid
      FROM emails e
      LEFT JOIN user_by_email ube ON ube.lemail = lower(e.from_email)
      WHERE ${teWhere}
    ),
    seq AS (
      SELECT
        thread_id, received_at, is_team, from_uid,
        LAG(received_at) OVER (PARTITION BY thread_id ORDER BY received_at, id) AS prev_at,
        LAG(is_team)     OVER (PARTITION BY thread_id ORDER BY received_at, id) AS prev_is_team
      FROM thread_emails
    ),
    -- Every counted response. from_uid may be NULL (team sender we can't match);
    -- those still count toward the overall stats but are dropped per-member.
    gaps AS (
      SELECT from_uid, EXTRACT(EPOCH FROM (received_at - prev_at)) / 86400.0 AS gap_days
      FROM seq
      WHERE ${gapWhere}
    ),
    -- Log-spaced bucket lower bounds, bound once and reused by both histograms.
    bins AS (SELECT ${HIST_EDGES}::float8[] AS edges),
    -- Top 5 members by MEDIAN delay (>10 responses). Median resists the
    -- multi-week outliers that a mean would let dominate the ranking.
    member_med AS (
      SELECT
        g.from_uid,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY g.gap_days) AS median_days,
        AVG(g.gap_days) AS avg_days,
        MAX(g.gap_days) AS max_days,
        COUNT(*)::int AS cnt
      FROM gaps g
      WHERE g.from_uid IS NOT NULL
      GROUP BY g.from_uid
      HAVING COUNT(*) > 10
      ORDER BY median_days DESC, max_days DESC, cnt DESC
      LIMIT 5
    )
    -- Aggregate stats across every response.
    SELECT 'overall' AS kind, NULL::uuid AS user_id, NULL::text AS name, NULL::text AS email,
           AVG(g.gap_days)::float8 AS avg_days,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY g.gap_days)::float8 AS median_days,
           MAX(g.gap_days)::float8 AS max_days, COUNT(*)::int AS cnt,
           NULL::int AS bucket, NULL::int AS bucket_count
    FROM gaps g
    UNION ALL
    -- Per-member stats for the top 5.
    SELECT 'member_stat', mm.from_uid, CONCAT(u.first_name, ' ', u.last_name), u.email,
           mm.avg_days::float8, mm.median_days::float8, mm.max_days::float8, mm.cnt,
           NULL::int, NULL::int
    FROM member_med mm INNER JOIN users u ON u.id = mm.from_uid
    UNION ALL
    -- Aggregate histogram: response count per log bucket.
    SELECT 'agg_bin', NULL::uuid, NULL::text, NULL::text,
           NULL::float8, NULL::float8, NULL::float8, NULL::int,
           width_bucket(g.gap_days, b.edges), COUNT(*)::int
    FROM gaps g CROSS JOIN bins b
    GROUP BY width_bucket(g.gap_days, b.edges)
    UNION ALL
    -- Per-member histogram: same buckets, only for the top-5 members.
    SELECT 'member_bin', g.from_uid, NULL::text, NULL::text,
           NULL::float8, NULL::float8, NULL::float8, NULL::int,
           width_bucket(g.gap_days, b.edges), COUNT(*)::int
    FROM gaps g CROSS JOIN bins b
    WHERE g.from_uid IN (SELECT from_uid FROM member_med)
    GROUP BY g.from_uid, width_bucket(g.gap_days, b.edges)
  `;

  const num = (x) => (x == null ? null : Number(x));
  const emptyHist = () => new Array(HIST_BUCKET_COUNT).fill(0);

  let overall = { avgDays: null, medianDays: null, maxDays: null, count: 0 };
  const aggHist = emptyHist();
  // Preserve the SQL median-desc order by keying insertion off a Map.
  const memberMap = new Map();

  for (const r of rows) {
    if (r.kind === 'overall') {
      overall = {
        avgDays: num(r.avg_days),
        medianDays: num(r.median_days),
        maxDays: num(r.max_days),
        count: r.cnt ?? 0,
      };
    } else if (r.kind === 'member_stat') {
      memberMap.set(r.user_id, {
        userId: r.user_id,
        name: nameOrNull(r.name) || '(unknown)',
        email: r.email,
        roles: [],
        medianDays: num(r.median_days),
        avgDays: num(r.avg_days),
        maxDays: num(r.max_days),
        count: r.cnt ?? 0,
        histogram: emptyHist(),
      });
    } else if (r.kind === 'agg_bin') {
      if (r.bucket != null && r.bucket < HIST_BUCKET_COUNT) aggHist[r.bucket] = r.bucket_count ?? 0;
    } else if (r.kind === 'member_bin') {
      const m = memberMap.get(r.user_id);
      if (m && r.bucket != null && r.bucket < HIST_BUCKET_COUNT) m.histogram[r.bucket] = r.bucket_count ?? 0;
    }
  }

  const members = [...memberMap.values()]
    .sort((a, b) => (b.medianDays || 0) - (a.medianDays || 0));

  // Each top-5 member's roles are the well-known job titles they hold on the
  // teams of the customers actually served in this scope — i.e. their
  // `user_customers` assignment roles, restricted to the customers whose
  // in-scope threads feed the delay metric. Mapped through the well-known UUID
  // table (same "Book Keeper" etc. labels as the Customers > Team column), with
  // the `roles` table as a fallback. Run as a small follow-up query keyed on the
  // already-computed top-5 ids so the heavy gap scan stays untouched.
  if (members.length) {
    const memberIds = members.map((m) => m.userId);
    const roleRows = await db`
      SELECT DISTINCT uc.user_id, uc.role_id, r.name AS role_name
      FROM user_customers uc
      LEFT JOIN roles r ON r.id = uc.role_id
      WHERE uc.user_id = ANY(${memberIds}::uuid[])
        AND uc.role_id IS NOT NULL
        AND uc.customer_id IN (
          SELECT DISTINCT ep.customer_id
          FROM emails e
          INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
          WHERE ${threadWhere} AND ep.customer_id IS NOT NULL
        )
    `;
    const rolesByUser = new Map();
    for (const r of roleRows) {
      const label = WELL_KNOWN_ROLE_NAMES[r.role_id] ?? nameOrNull(r.role_name);
      if (!label) continue;
      let set = rolesByUser.get(r.user_id);
      if (!set) { set = new Set(); rolesByUser.set(r.user_id, set); }
      set.add(label);
    }
    for (const m of members) {
      m.roles = [...(rolesByUser.get(m.userId) || [])].sort();
    }
  }

  return {
    overall,
    histogram: { labels: HIST_LABELS, counts: aggHist },
    members,
  };
}

// Average resolution time (in days): for every resolved task (status = 1)
// completed inside the date range, the gap between created_at (thread opened)
// and completed_at (marked resolved). Scoped to customer threads via the same
// email_participants join the rest of the dashboard uses.
async function getAvgResolutionTime({ dateFrom, dateTo, customerId, teamMemberId }) {
  const from = parseDate(dateFrom, false);
  const to   = parseDate(dateTo, true);

  const parts = [
    db`t.status = 1`,
    db`t.completed_at IS NOT NULL`,
    db`ep.customer_id IS NOT NULL`,
  ];
  if (TENANT_ID) parts.push(db`e.tenant_id = ${TENANT_ID}`);
  if (from) parts.push(db`t.completed_at >= ${from.toISOString()}::timestamp`);
  if (to)   parts.push(db`t.completed_at <= ${to.toISOString()}::timestamp`);
  parts.push(...dashboardScopeParts({ customerId, teamMemberId }));
  const where = andAll(parts);

  const rows = await db`
    SELECT
      AVG(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 86400.0) AS avg_days,
      COUNT(*)::int AS count
    FROM tasks t
    INNER JOIN emails e ON e.id = t.email_id
    INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
    WHERE ${where}
  `;
  const r = rows[0] || {};
  return { avgDays: r.avg_days == null ? null : Number(r.avg_days), count: r.count ?? 0 };
}

// Paginated customer search for the Customers section. Aggregates per-
// customer counts (total emails, signal breakdowns, avg TAT, last email) in
// the selected date range. Mirrors the main inboxpulse Customers table.
async function getCustomersList({ search, dateFrom, dateTo, customerId, teamMemberId, sortBy, sortOrder, limit, offset }) {
  const safeLimit  = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(limit ?? DEFAULT_PAGE_SIZE, 10)));
  const safeOffset = Math.max(0, parseInt(offset ?? 0, 10));
  const from = parseDate(dateFrom, false);
  const to   = parseDate(dateTo, true);

  // Customers themselves are not date-filtered, but their aggregates are.
  const custParts = [];
  if (TENANT_ID) custParts.push(db`c.tenant_id = ${TENANT_ID}`);
  custParts.push(db`c.row_status = 0`);
  if (search) {
    const term = `%${search}%`;
    custParts.push(db`(
      c.name ILIKE ${term}
      OR EXISTS (SELECT 1 FROM customer_domains cd WHERE cd.customer_id = c.id AND cd.domain ILIKE ${term})
    )`);
  }
  if (customerId) {
    custParts.push(db`c.id = ${customerId}`);
  }
  if (teamMemberId) {
    custParts.push(db`EXISTS (
      SELECT 1 FROM user_customers uc
      WHERE uc.customer_id = c.id AND uc.user_id = ${teamMemberId}
    )`);
  }
  const custWhere = andAll(custParts);

  // Build email-aggregate predicates (applied inside subselect).
  const emailDateParts = [];
  if (from) emailDateParts.push(db`e.received_at >= ${from.toISOString()}::timestamp`);
  if (to)   emailDateParts.push(db`e.received_at <= ${to.toISOString()}::timestamp`);
  const emailDateWhere = emailDateParts.length
    ? andAll(emailDateParts)
    : db`TRUE`;

  // Order column mapping — match the React app's accessor names.
  const sortMap = {
    name:           db`c.name`,
    emailCount:     db`agg.total_emails`,
    negativeCount:  db`agg.negative`,
    upsellCount:    db`agg.upsell`,
    churnCount:     db`agg.churn`,
    positiveCount:  db`agg.positive`,
    lastContactDate:db`agg.last_contact`,
  };
  const sortCol = sortMap[sortBy] || db`c.name`;
  const sortDir = sortOrder === 'desc' ? db`DESC NULLS LAST` : db`ASC NULLS LAST`;

  const countRows = await db`
    SELECT COUNT(*)::int AS count
    FROM customers c
    WHERE ${custWhere}
  `;
  const total = countRows[0]?.count ?? 0;

  const rows = await db`
    SELECT
      c.id,
      c.name,
      (SELECT cd.domain FROM customer_domains cd WHERE cd.customer_id = c.id ORDER BY cd.created_at ASC LIMIT 1) AS domain,
      agg.total_emails,
      agg.positive,
      agg.neutral,
      agg.negative,
      agg.upsell,
      agg.churn,
      agg.avg_tat_days,
      agg.last_contact
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
        AND ${emailDateWhere}
    ) agg ON true
    WHERE ${custWhere}
    ORDER BY ${sortCol} ${sortDir}, c.name ASC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `;

  const items = rows.map((r) => ({
    id: r.id,
    name: r.name || '(unnamed)',
    domain: r.domain || null,
    totalEmails: r.total_emails ?? 0,
    positiveCount: r.positive ?? 0,
    neutralCount: r.neutral ?? 0,
    negativeCount: r.negative ?? 0,
    upsellCount: r.upsell ?? 0,
    churnCount: r.churn ?? 0,
    avgTatDays: r.avg_tat_days == null ? null : Number(r.avg_tat_days),
    lastContact: r.last_contact,
  }));

  return { items, total, limit: safeLimit, offset: safeOffset };
}

// ---------------------------------------------------------------------------
// Customer detail (Emails / Contacts / Team)
// ---------------------------------------------------------------------------

async function getCustomerById(customerId) {
  const tenantParts = TENANT_ID ? [db`c.tenant_id = ${TENANT_ID}`] : [];
  const tenantWhere = tenantParts.length ? andAll(tenantParts) : db`TRUE`;

  const rows = await db`
    SELECT c.id, c.name, c.website, c.industry
    FROM customers c
    WHERE c.id = ${customerId}
      AND ${tenantWhere}
    LIMIT 1
  `;
  if (rows.length === 0) return null;

  const domainRows = await db`
    SELECT domain
    FROM customer_domains
    WHERE customer_id = ${customerId}
    ORDER BY created_at ASC
  `;

  return {
    id: rows[0].id,
    name: rows[0].name || '(unnamed)',
    website: rows[0].website,
    industry: rows[0].industry,
    domains: domainRows.map((r) => r.domain),
  };
}

async function getCustomerContacts(customerId) {
  const rows = await db`
    SELECT id, name, title, email, phone, mobile
    FROM contacts
    WHERE customer_id = ${customerId}
    ORDER BY name ASC NULLS LAST
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    title: r.title,
    email: r.email,
    phone: r.phone,
    mobile: r.mobile,
  }));
}

async function addCustomerTeamMember(customerId, { userId, roleId }) {
  if (!userId) throw new Error('userId is required');

  // Insert; if the (user_id, customer_id) pair already exists, treat the
  // POST as a role update so the caller can use one endpoint for both.
  await db`
    INSERT INTO user_customers (user_id, customer_id, role_id)
    VALUES (${userId}, ${customerId}, ${roleId || null})
    ON CONFLICT (user_id, customer_id) DO UPDATE SET role_id = EXCLUDED.role_id
  `;
  return getCustomerTeam(customerId);
}

async function getCustomerTeam(customerId) {
  // Roles for the Team column resolve in this order:
  //   1. `user_customers.role_id` looked up in the well-known UUID map
  //      (matches the main InboxPulse app's labels — "Book Keeper" etc.)
  //   2. `user_customers.role_id` looked up in the `roles` table
  //   3. `users.role_id` looked up in the `roles` table (user's org-wide
  //      primary role, used as a fallback so the column isn't empty for
  //      users without an explicit per-customer assignment role)
  const rows = await db`
    SELECT
      u.id, u.first_name, u.last_name, u.email,
      uc.role_id          AS assignment_role_id,
      ar.name             AS assignment_role_name,
      u.role_id           AS primary_role_id,
      pr.name             AS primary_role_name
    FROM user_customers uc
    INNER JOIN users u ON u.id = uc.user_id
    LEFT  JOIN roles ar ON ar.id = uc.role_id
    LEFT  JOIN roles pr ON pr.id = u.role_id
    WHERE uc.customer_id = ${customerId}
    ORDER BY u.first_name ASC, u.last_name ASC
  `;
  return rows.map((r) => {
    const wellKnown = r.assignment_role_id ? WELL_KNOWN_ROLE_NAMES[r.assignment_role_id] : null;
    const roleName  = wellKnown ?? r.assignment_role_name ?? r.primary_role_name ?? null;
    return {
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      roleId: r.assignment_role_id ?? r.primary_role_id,
      role:   roleName,
      assignmentRoleId: r.assignment_role_id,
      primaryRoleId:    r.primary_role_id,
    };
  });
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const USER_ROW_STATUS_LABEL = { 0: 'Active', 1: 'Inactive', 2: 'Archived' };

async function getUsersList({ search, status, sortBy, sortOrder, limit, offset }) {
  const safeLimit  = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(limit ?? DEFAULT_PAGE_SIZE, 10)));
  const safeOffset = Math.max(0, parseInt(offset ?? 0, 10));

  const parts = [];
  if (TENANT_ID) parts.push(db`u.tenant_id = ${TENANT_ID}`);
  if (status === 'inactive') {
    parts.push(db`u.row_status IN (1, 2)`);
  } else {
    parts.push(db`u.row_status = 0`);
  }
  if (search) {
    const term = `%${search}%`;
    parts.push(db`(
      u.first_name ILIKE ${term}
      OR u.last_name ILIKE ${term}
      OR u.email ILIKE ${term}
      OR r.name ILIKE ${term}
    )`);
  }
  // andAll requires at least one element — guarded above.
  const where = andAll(parts);

  const sortMap = {
    name:        db`u.first_name`,
    role:        db`r.name`,
    lastLoginAt: db`u.last_login_at`,
  };
  const sortCol = sortMap[sortBy] || db`u.first_name`;
  const sortDir = sortOrder === 'desc' ? db`DESC NULLS LAST` : db`ASC NULLS LAST`;

  const countRows = await db`
    SELECT COUNT(*)::int AS count
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE ${where}
  `;
  const total = countRows[0]?.count ?? 0;

  const rows = await db`
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.email,
      u.can_login,
      u.timezone,
      u.last_login_at,
      u.row_status,
      r.id   AS role_id,
      r.name AS role_name,
      (SELECT COUNT(*)::int FROM user_managers  um WHERE um.user_id  = u.id) AS manager_count,
      (SELECT COUNT(*)::int FROM user_customers uc WHERE uc.user_id = u.id) AS customer_count
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE ${where}
    ORDER BY ${sortCol} ${sortDir}, u.last_name ASC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `;

  return {
    items: rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      canLogin: r.can_login,
      timezone: r.timezone,
      lastLoginAt: r.last_login_at,
      rowStatus: r.row_status,
      statusLabel: USER_ROW_STATUS_LABEL[r.row_status] ?? 'Unknown',
      roleId: r.role_id,
      role: r.role_name,
      reportsToCount: r.manager_count,
      customerCount: r.customer_count,
    })),
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getUserById(userId) {
  const tenantParts = TENANT_ID ? [db`u.tenant_id = ${TENANT_ID}`] : [];
  const tenantWhere = tenantParts.length ? andAll(tenantParts) : db`TRUE`;

  const rows = await db`
    SELECT
      u.id, u.first_name, u.last_name, u.email,
      u.can_login, u.timezone, u.last_login_at, u.row_status,
      r.id AS role_id, r.name AS role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ${userId}
      AND ${tenantWhere}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];

  // Reports-to managers + customer assignments. These come back as small
  // arrays so the drawer can render the chips/list without extra round-trips.
  const managers = await db`
    SELECT u2.id, u2.first_name, u2.last_name, u2.email
    FROM user_managers um
    INNER JOIN users u2 ON u2.id = um.manager_id
    WHERE um.user_id = ${userId}
    ORDER BY u2.first_name ASC, u2.last_name ASC
  `;

  const customerAssignments = await db`
    SELECT uc.customer_id, c.name AS customer_name, uc.role_id, r.name AS role_name
    FROM user_customers uc
    INNER JOIN customers c ON c.id = uc.customer_id
    LEFT  JOIN roles r ON r.id = uc.role_id
    WHERE uc.user_id = ${userId}
    ORDER BY c.name ASC
  `;

  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    canLogin: r.can_login,
    timezone: r.timezone,
    lastLoginAt: r.last_login_at,
    rowStatus: r.row_status,
    statusLabel: USER_ROW_STATUS_LABEL[r.row_status] ?? 'Unknown',
    roleId: r.role_id,
    role: r.role_name,
    managers: managers.map((m) => ({
      id: m.id,
      firstName: m.first_name,
      lastName: m.last_name,
      email: m.email,
    })),
    customerAssignments: customerAssignments.map((c) => ({
      customerId: c.customer_id,
      customerName: c.customer_name,
      roleId: c.role_id,
      roleName: c.role_name,
    })),
  };
}

async function updateUser(userId, patch) {
  // Build an UPDATE with only the fields actually supplied so blank inputs
  // don't clobber existing data.
  const sets = [];
  if (typeof patch.firstName === 'string') sets.push(db`first_name = ${patch.firstName}`);
  if (typeof patch.lastName  === 'string') sets.push(db`last_name = ${patch.lastName}`);
  if (patch.roleId === null || typeof patch.roleId === 'string') sets.push(db`role_id = ${patch.roleId || null}`);
  if (typeof patch.timezone  === 'string') sets.push(db`timezone = ${patch.timezone}`);
  if (typeof patch.canLogin  === 'boolean') sets.push(db`can_login = ${patch.canLogin}`);
  if (typeof patch.rowStatus === 'number')  sets.push(db`row_status = ${patch.rowStatus}`);

  if (sets.length > 0) {
    sets.push(db`updated_at = NOW()`);
    const setClause = sets.reduce((acc, part) => db`${acc}, ${part}`);
    const tenantParts = TENANT_ID ? [db`tenant_id = ${TENANT_ID}`] : [];
    const tenantWhere = tenantParts.length ? andAll(tenantParts) : db`TRUE`;
    await db`UPDATE users SET ${setClause} WHERE id = ${userId} AND ${tenantWhere}`;
  }

  // managerIds and customerAssignments are replace-the-whole-list operations
  // so the drawer can use a single PATCH call instead of N small mutations.
  if (Array.isArray(patch.managerIds)) {
    await db`DELETE FROM user_managers WHERE user_id = ${userId}`;
    for (const mid of patch.managerIds) {
      if (!mid || mid === userId) continue;
      await db`
        INSERT INTO user_managers (user_id, manager_id)
        VALUES (${userId}, ${mid})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  if (Array.isArray(patch.customerAssignments)) {
    await db`DELETE FROM user_customers WHERE user_id = ${userId}`;
    for (const a of patch.customerAssignments) {
      if (!a?.customerId) continue;
      await db`
        INSERT INTO user_customers (user_id, customer_id, role_id)
        VALUES (${userId}, ${a.customerId}, ${a.roleId || null})
        ON CONFLICT (user_id, customer_id) DO UPDATE SET role_id = EXCLUDED.role_id
      `;
    }
  }

  return getUserById(userId);
}

async function getRoles() {
  const parts = [];
  if (TENANT_ID) parts.push(db`tenant_id = ${TENANT_ID}`);
  const where = parts.length ? andAll(parts) : db`TRUE`;
  const rows = await db`
    SELECT id, name
    FROM roles
    WHERE ${where}
    ORDER BY name ASC
  `;
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

// Team roles assignable on a customer — these are the well-known UUIDs
// stored in `user_customers.role_id`, not the system roles. Exposed as a
// separate endpoint so the Customers > Team dropdown shows the right
// vocabulary (Book Keeper, Account Manager, …) without polluting the
// Users drawer's primary-role dropdown.
async function getTeamRoles() {
  return Object.entries(WELL_KNOWN_ROLE_NAMES)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Full message list for a thread, sorted oldest -> newest. Used by the AI
// Analysis thread view to render the whole conversation, not just the one
// clicked message.
async function getThreadEmails(threadId) {
  const tenantParts = TENANT_ID ? [db`e.tenant_id = ${TENANT_ID}`] : [];
  const tenantWhere = tenantParts.length ? andAll(tenantParts) : db`TRUE`;

  const rows = await db`
    SELECT
      e.id, e.thread_id, e.subject, e.body,
      e.from_email, e.from_name, e.tos, e.ccs, e.bccs,
      e.received_at, e.signals,
      e.analysis_status
    FROM emails e
    WHERE e.thread_id = ${threadId}
      AND ${tenantWhere}
    ORDER BY e.received_at ASC
  `;

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
    isAnalyzed: r.analysis_status === EMAIL_ANALYSIS_STATUS_COMPLETED,
  }));
}

function toAnalyzedEmail(r) {
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

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (origin.startsWith('chrome-extension://')
      || origin.startsWith('http://localhost')
      || origin.startsWith('http://127.0.0.1')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return respond(res, 200, { status: 'ok', tenantScoped: !!TENANT_ID });
    }

    if (req.method === 'POST' && pathname === '/api/emails/analyzed/search') {
      const body = await readJson(req);
      const result = await searchAnalyzedEmails(body || {});
      return respond(res, 200, result);
    }

    if (req.method === 'GET' && pathname === '/api/emails/analyzed/stats') {
      const result = await getStats(parsed.query.days);
      return respond(res, 200, result);
    }

    if (req.method === 'GET' && pathname === '/api/dashboard/summary') {
      return respond(res, 200, await getDashboardSummary(parsed.query));
    }
    if (req.method === 'GET' && pathname === '/api/dashboard/sentiment-distribution') {
      return respond(res, 200, await getSentimentDistribution(parsed.query));
    }
    if (req.method === 'GET' && pathname === '/api/dashboard/sentiment-trend') {
      return respond(res, 200, await getSentimentTrend());
    }
    if (req.method === 'GET' && pathname === '/api/dashboard/volume-trend') {
      return respond(res, 200, await getVolumeTrend(parsed.query));
    }
    if (req.method === 'GET' && pathname === '/api/dashboard/tat-metrics') {
      return respond(res, 200, await getTatMetrics(parsed.query));
    }
    if (req.method === 'GET' && pathname === '/api/dashboard/recent-escalations') {
      return respond(res, 200, await getRecentEscalations(parsed.query));
    }
    if (req.method === 'GET' && pathname === '/api/dashboard/important-escalations') {
      return respond(res, 200, await getImportantEscalations(parsed.query));
    }
    if (req.method === 'GET' && pathname === '/api/dashboard/most-escalated-customers') {
      return respond(res, 200, await getMostEscalatedCustomers(parsed.query));
    }
    if (req.method === 'GET' && pathname === '/api/dashboard/churn-levels') {
      return respond(res, 200, await getChurnLevelCounts(parsed.query));
    }
    if (req.method === 'GET' && pathname === '/api/dashboard/team-responsiveness') {
      return respond(res, 200, await getTeamResponsiveness(parsed.query));
    }
    if (req.method === 'GET' && pathname === '/api/dashboard/resolution-time') {
      return respond(res, 200, await getAvgResolutionTime(parsed.query));
    }
    if (req.method === 'POST' && pathname === '/api/customers/search') {
      const body = await readJson(req);
      return respond(res, 200, await getCustomersList(body || {}));
    }
    const custIdMatch = pathname.match(/^\/api\/customers\/([0-9a-fA-F-]{36})(\/(contacts|team))?$/);
    if (custIdMatch) {
      const id = custIdMatch[1];
      const sub = custIdMatch[3];
      if (req.method === 'GET') {
        if (sub === 'contacts') return respond(res, 200, await getCustomerContacts(id));
        if (sub === 'team')     return respond(res, 200, await getCustomerTeam(id));
        const cust = await getCustomerById(id);
        if (!cust) return respond(res, 404, { error: 'Not found' });
        return respond(res, 200, cust);
      }
      if (req.method === 'POST' && sub === 'team') {
        const body = await readJson(req);
        const team = await addCustomerTeamMember(id, body || {});
        return respond(res, 200, team);
      }
    }

    if (req.method === 'POST' && pathname === '/api/users/search') {
      const body = await readJson(req);
      return respond(res, 200, await getUsersList(body || {}));
    }
    if (req.method === 'GET' && pathname === '/api/roles') {
      return respond(res, 200, await getRoles());
    }
    if (req.method === 'GET' && pathname === '/api/team-roles') {
      return respond(res, 200, await getTeamRoles());
    }
    const userIdMatch = pathname.match(/^\/api\/users\/([0-9a-fA-F-]{36})$/);
    if (userIdMatch) {
      const id = userIdMatch[1];
      if (req.method === 'GET') {
        const u = await getUserById(id);
        if (!u) return respond(res, 404, { error: 'Not found' });
        return respond(res, 200, u);
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const u = await updateUser(id, body || {});
        if (!u) return respond(res, 404, { error: 'Not found' });
        return respond(res, 200, u);
      }
    }

    const threadMatch = pathname.match(/^\/api\/emails\/threads\/([0-9a-fA-F-]{36})$/);
    if (req.method === 'GET' && threadMatch) {
      const messages = await getThreadEmails(threadMatch[1]);
      return respond(res, 200, { messages });
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([0-9a-fA-F-]{36})$/);
    if (req.method === 'PATCH' && taskMatch) {
      const body = await readJson(req);
      const updated = await updateTaskStatus(taskMatch[1], body?.status);
      return respond(res, 200, updated);
    }

    const idMatch = pathname.match(/^\/api\/emails\/analyzed\/([0-9a-fA-F-]{36})$/);
    if (req.method === 'GET' && idMatch) {
      const result = await getAnalyzedEmailById(idMatch[1]);
      if (!result) return respond(res, 404, { error: 'Not found' });
      return respond(res, 200, result);
    }

    respond(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[server] error on', pathname, err);
    respond(res, 500, { error: err.message });
  }
});

function respond(res, status, body) {
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; });
    req.on('end', () => {
      if (!chunks) return resolve({});
      try { resolve(JSON.parse(chunks)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] tenant scope: ${TENANT_ID || '(all tenants)'}`);
});

process.on('SIGINT', async () => {
  console.log('[server] shutting down');
  await db.end();
  process.exit(0);
});
