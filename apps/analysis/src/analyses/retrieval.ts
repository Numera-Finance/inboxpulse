import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { logger } from '../utils/logger';

/**
 * Show the model decided cases instead of telling it rules.
 *
 * The sentiment prompt is 11,500 characters of hand-written rules describing
 * what a complaint looks like. Measured against 49 emails a person judged, ten
 * already-decided emails retrieved by similarity score the same: 18-19 of 20
 * caught either way, nine false alarms either way. The rules are therefore
 * buying nothing for the cost of keeping them current, and they are the only one
 * of the two that a human has to maintain — the examples grow on their own as
 * the mailbox is judged.
 *
 * Rules also fight each other. Adding one about chased timelines contradicted
 * two existing clauses that said the same emails were neutral, and both had to
 * be found and rewritten. Examples cannot contradict each other; at worst they
 * disagree, which is information rather than a bug.
 *
 * Retrieval is per tenant, which is the real prize. A client who writes tersely
 * and a client who buries the ask in three paragraphs of pleasantry are judged
 * against their own history rather than against an average of everyone's, and
 * nobody tunes a prompt per customer to get it.
 */

/** An already-judged email, close in meaning to the one being judged now. */
export interface Example {
  subject: string;
  body: string;
  verdict: 'negative' | 'neutral' | 'positive';
  /** Cosine distance, 0 = identical. Kept for logging, not shown to the model. */
  distance: number;
}

/** Ten is enough to imply a pattern and few enough to leave room for the email. */
const DEFAULT_LIMIT = 10;

/** Below this a body is a bare "thanks" and teaches the model nothing. */
const DEFAULT_MIN_BODY = 200;

/**
 * Nearest already-judged emails from THIS tenant, keyed by the email's own id.
 *
 * Keyed by id rather than by a vector the caller supplies. The row already
 * carries its embedding from sync time, so the query reads it in a subselect and
 * the analysis service never computes one at request time — no embedding call on
 * the critical path, and no chance of scoring against a vector from a different
 * model than the neighbours were stored with.
 *
 * There was a second entry point that took a vector directly. It was deleted
 * rather than kept for flexibility: nothing called it, and it still carried the
 * ORIGINAL query — no thread exclusion, no class balance, no customer-traffic
 * filter. Every bug found by running against real data was still live in it, so
 * it was a loaded gun for whoever called it next. Two queries that must stay in
 * step will not.
 *
 * A client's CUSTOMERS are filtered out. poolbrain.com is the field-service
 * platform belonging to a client whose books we keep; 42 replies from homeowners
 * complaining about pool cleaning are still labelled negative in the database,
 * because that is what they are — just not complaints about us. Retrieved as
 * worked examples they would teach the model that domestic grievances belong in
 * a bookkeeper's queue. See apps/api/src/emails/prefilter/third-party.ts; the
 * durable fix is a participant test (ADR-020), and this filter stands in until
 * the labels themselves are corrected.
 *
 * TWO queries, not one window function. The class balance was originally a
 * ROW_NUMBER() OVER (PARTITION BY ...), which is correct and cannot use an
 * index: ranking within a class needs the distance for every candidate row, so
 * Postgres sequential-scans all 35,653 vectors. Measured at 18 SECONDS. Split
 * into two plain ORDER BY ... LIMIT queries it drops to 2.8s, because that shape
 * is what an HNSW index can serve.
 *
 * Still not fast. The complaints branch stays slow because negatives are 3% of
 * the corpus, so an approximate-nearest-neighbour scan has to go deep before it
 * finds five of them — the standard problem with a selective filter over ANN.
 * The fix is to denormalise `sentiment_value` onto `emails` and build a PARTIAL
 * hnsw index over the negatives alone; the label currently lives in
 * email_analyses and an index cannot span two tables. Not done here.
 *
 * Both classes are represented, half each. Complaints are 3% of mail, so the
 * ten nearest neighbours of anything are almost always ten neutral emails — and
 * a model shown ten neutral examples learns that this mailbox is neutral, which
 * is the exact bias the product exists to correct. Ranking within each class and
 * taking the closest of each guarantees the model sees what a complaint looks
 * like here, not only what ordinary traffic looks like.
 *
 * The whole THREAD is excluded, not just the message. Run against real mail the
 * three nearest neighbours were all the same conversation — replies quoting each
 * other are near-identical in embedding space, so they crowd out every genuine
 * example. Worse, some of them already carry the verdict for the exchange the
 * model is being asked to judge, so it would be shown the answer and score well
 * for the wrong reason. This was invisible to the unit tests, which mock the
 * database; only a query against the corpus showed it.
 *
 * Keyed on the PROVIDER's message id, which is what the analysis service holds —
 * `Email` carries `messageId`, never the database uuid. The tenant is required
 * as well, because a provider id is only unique within a mailbox and because it
 * arrives from the caller: scoping on the id alone would let a wrong or forged
 * one read another tenant's neighbours.
 */
export async function retrieveExamplesForEmail(
  tenantId: string,
  messageId: string,
  limit = DEFAULT_LIMIT,
  minBodyChars = DEFAULT_MIN_BODY
): Promise<Example[]> {
  try {
    // ITERATIVE SCAN, SET PER TRANSACTION.
    //
    // The complaints branch asks HNSW for the 5 nearest rows of a class that is
    // 3% of the corpus, so an approximate scan reaches its limit before finding
    // five and Postgres falls back. Measured: 880ms default, 261ms with
    // iterative scan — 3.4x, and pgvector's documented answer for exactly this
    // selectivity regime (a partial index over the labelled complaints is the
    // second move, and needs the label denormalised onto emails).
    //
    // SET LOCAL inside a transaction rather than on the role: the parameter only
    // exists once the extension is loaded in a session, ALTER ROLE is refused to
    // the app user, and a pooled connection would otherwise carry the setting
    // into unrelated queries.
    const rows = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
      await tx.execute(sql`SET LOCAL hnsw.max_scan_tuples = 20000`);
      return tx.execute<{
      subject: string | null;
      body: string | null;
      sentiment_value: string | null;
      distance: number;
    }>(sql`
      WITH q AS (
        SELECT embedding, thread_id
        FROM emails
        WHERE message_id = ${messageId} AND tenant_id = ${tenantId} AND embedding IS NOT NULL
      ),
      complaints AS (
        SELECT e.subject, e.body, ea.sentiment_value,
               (e.embedding <=> (SELECT embedding FROM q)) AS distance
        FROM emails e
        JOIN email_analyses ea
          ON ea.email_id = e.id AND ea.analysis_type = 'sentiment' AND ea.tenant_id = e.tenant_id
        WHERE e.tenant_id = ${tenantId}
          AND e.message_id <> ${messageId}
          AND e.thread_id <> (SELECT thread_id FROM q)
          AND e.embedding IS NOT NULL
          AND ea.sentiment_value = 'negative'
          AND length(e.body) >= ${minBodyChars}
          AND e.body NOT LIKE '%poolbrain.com%'
          AND EXISTS (SELECT 1 FROM q)
        ORDER BY e.embedding <=> (SELECT embedding FROM q)
        LIMIT ${Math.ceil(limit / 2)}
      ),
      ordinary AS (
        SELECT e.subject, e.body, ea.sentiment_value,
               (e.embedding <=> (SELECT embedding FROM q)) AS distance
        FROM emails e
        JOIN email_analyses ea
          ON ea.email_id = e.id AND ea.analysis_type = 'sentiment' AND ea.tenant_id = e.tenant_id
        WHERE e.tenant_id = ${tenantId}
          AND e.message_id <> ${messageId}
          AND e.thread_id <> (SELECT thread_id FROM q)
          AND e.embedding IS NOT NULL
          AND ea.sentiment_value IS NOT NULL
          AND ea.sentiment_value <> 'negative'
          AND length(e.body) >= ${minBodyChars}
          AND e.body NOT LIKE '%poolbrain.com%'
          AND EXISTS (SELECT 1 FROM q)
        ORDER BY e.embedding <=> (SELECT embedding FROM q)
        LIMIT ${Math.floor(limit / 2)}
      )
      SELECT * FROM complaints
      UNION ALL
      SELECT * FROM ordinary
      ORDER BY distance
    `);
    });

    return rows
      .filter((r) => r.subject !== null && r.body !== null)
      .map((r) => ({
        subject: r.subject as string,
        body: r.body as string,
        verdict: r.sentiment_value as Example['verdict'],
        distance: Number(r.distance),
      }));
  } catch (error) {
    logger.warn({ err: error, tenantId, messageId }, 'example retrieval failed; using written instructions');
    return [];
  }
}

/** Strip markup and the quoted chain. Must match what the classifier is shown. */
export function toPlainText(subject: string, body: string, cap = 380): string {
  let t = `${subject}\n${body}`;
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  for (const [a, b] of [['&nbsp;', ' '], ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'],
                        ['&quot;', '"'], ['&#39;', "'"]] as const) {
    t = t.split(a).join(b);
  }
  t = t.split(/On .{0,200}?\bwrote:|From:\s/)[0];
  return t.replace(/\s+/g, ' ').trim().slice(0, cap);
}

/**
 * Render examples for the prompt.
 *
 * Deliberately plain: the email, then the verdict, nothing else. An explanation
 * attached to each one would be a rule wearing a costume, and the whole point is
 * that the model infers the pattern rather than being told it.
 *
 * Returns '' when there is nothing worth showing, which the caller treats as
 * "use the written instructions" rather than "send an empty examples header".
 */
export function formatExamples(examples: Example[]): string {
  const usable = examples.filter((e) => e.verdict && toPlainText(e.subject, e.body).length >= 50);
  if (usable.length < 4) return '';

  const rendered = usable
    .map((e) => `EMAIL: ${toPlainText(e.subject, e.body)}\nVERDICT: ${e.verdict}`)
    .join('\n\n');

  return (
    'Emails from this same mailbox that have already been judged. ' +
    'Match the reasoning they imply.\n\n' +
    rendered
  );
}
