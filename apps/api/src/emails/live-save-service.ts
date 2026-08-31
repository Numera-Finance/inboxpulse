import { injectable, inject } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import type { Database } from '@crm/database';
import { Signal } from '@crm/shared';
import { emailThreads, emails } from './schema';
import { emailAnalyses } from './analysis-schema';
import { createEmailAnalysisRecord } from './analysis-utils';
import { logger } from '../utils/logger';

/**
 * File a message the SIDEBAR read, together with the reading it produced.
 *
 * Why this is not `bulkInsertWithThreads`
 * ---------------------------------------
 * That path is the ingestion pipeline: it takes a provider's own payload, runs
 * change detection, and emits analysis events for the batch analyser to pick up.
 * None of that applies here. This is one message, already read, already
 * analysed, arriving from a person who pressed a button — and routing it through
 * the sync path would enqueue a second, different analysis of a message we have
 * just finished analysing.
 *
 * Why the analysis is written in the SAME transaction
 * ---------------------------------------------------
 * The email and its reading are one fact. Committing the row and then failing to
 * write the analysis produces exactly the state the button exists to fix — a
 * message present in the database with no analysis — except now the button will
 * not offer itself again, because the message is no longer missing. A half-write
 * here is worse than no write.
 *
 * PROVENANCE IS NOT OPTIONAL. Every row this writes carries `model_used`, which
 * existing corpus rows leave NULL, so anything the panel put in the database can
 * be found and removed with a single predicate. A write path with no way to
 * identify its own rows cannot be undone.
 */
/** The sentiment classes the live reading can produce, as stored signal codes. */
const SENTIMENT_SIGNAL: Record<LiveSaveInput['analysis']['sentiment'], number> = {
  positive: Signal.SENTIMENT_POSITIVE,
  negative: Signal.SENTIMENT_NEGATIVE,
  neutral: Signal.SENTIMENT_NEUTRAL,
};

@injectable()
export class LiveSaveService {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Upsert thread, message and analysis. Idempotent on the natural keys, so
   * pressing the button twice updates rather than duplicating.
   */
  async save(input: LiveSaveInput): Promise<LiveSaveResult> {
    const receivedAt = new Date(input.email.receivedAt);
    // `emails.signals` is the denormalised copy of the sentiment that the rest
    // of the product actually reads — the thread trend, the flagged list and the
    // panel's own severity colours all call getSentimentFromSignals(row.signals)
    // and never touch email_analyses.
    //
    // Leaving it null made the row contradict itself: analysis_status 3 says
    // "analysed", every reader of signals says "not analysed", and the sidebar
    // believed the readers — so a message this button had already saved came
    // back with an empty trend and the button offered again.
    const signals = [SENTIMENT_SIGNAL[input.analysis.sentiment]];
    // A thread must exist before the message can reference it, and
    // `email_threads.integration_id` is NOT NULL and part of the thread's unique
    // key — which is why integrationId is required from the caller rather than
    // guessed here. See ADDON_SAVE_INTEGRATION_ID.
    return this.db.transaction(async (tx) => {
      const [thread] = await tx
        .insert(emailThreads)
        .values({
          tenantId: input.tenantId,
          integrationId: input.integrationId,
          providerThreadId: input.thread.providerThreadId,
          subject: input.thread.subject,
          firstMessageAt: receivedAt,
          lastMessageAt: receivedAt,
        })
        .onConflictDoUpdate({
          target: [emailThreads.tenantId, emailThreads.integrationId, emailThreads.providerThreadId],
          set: { subject: input.thread.subject, updatedAt: new Date() },
        })
        .returning({ id: emailThreads.id });

      // A conflicting upsert that changes nothing can return no row on some
      // paths; fall back to reading it rather than inserting a second thread.
      const threadId =
        thread?.id ??
        (
          await tx
            .select({ id: emailThreads.id })
            .from(emailThreads)
            .where(
              and(
                eq(emailThreads.tenantId, input.tenantId),
                eq(emailThreads.integrationId, input.integrationId),
                eq(emailThreads.providerThreadId, input.thread.providerThreadId),
              ),
            )
            .limit(1)
        )[0]?.id;

      if (!threadId) throw new Error('could not resolve the thread after upsert');

      const [row] = await tx
        .insert(emails)
        .values({
          tenantId: input.tenantId,
          threadId,
          integrationId: input.integrationId,
          provider: input.provider,
          messageId: input.email.messageId,
          rfcMessageId: input.email.rfcMessageId ?? null,
          subject: input.email.subject,
          body: input.email.body,
          fromEmail: input.email.fromEmail,
          fromName: input.email.fromName ?? null,
          // Stored as [{ email }], not as bare strings — the columns are jsonb
          // typed `{ email, name? }[]` and every reader unpacks `.email`. Flat
          // strings type-check as jsonb and read back as undefined everywhere.
          tos: (input.email.tos ?? []).map((email) => ({ email })),
          ccs: (input.email.ccs ?? []).map((email) => ({ email })),
          receivedAt,
          signals,
          // 3 = completed. It IS analysed — by the panel, in this transaction —
          // so leaving it pending would queue the batch analyser to redo work
          // that is already done and already stored.
          analysisStatus: 3,
        })
        .onConflictDoUpdate({
          target: [emails.tenantId, emails.provider, emails.messageId],
          set: {
            body: input.email.body,
            subject: input.email.subject,
            // Updated, not just inserted: re-saving after a changed reading must
            // move the signal too, or the trend keeps showing the old sentiment.
            signals,
            analysisStatus: 3,
            updatedAt: new Date(),
          },
        })
        .returning({ id: emails.id });

      const emailId =
        row?.id ??
        (
          await tx
            .select({ id: emails.id })
            .from(emails)
            .where(
              and(
                eq(emails.tenantId, input.tenantId),
                eq(emails.provider, input.provider),
                eq(emails.messageId, input.email.messageId),
              ),
            )
            .limit(1)
        )[0]?.id;

      if (!emailId) throw new Error('could not resolve the email after upsert');

      const record = createEmailAnalysisRecord(
        emailId,
        input.tenantId,
        'sentiment',
        // `target` is deliberately absent: the live reading establishes a
        // sentiment without saying who it is aimed at, and the column is NULL on
        // all 35,856 existing rows for the same reason. Inventing one here would
        // put a value in a column nothing else populates.
        { value: input.analysis.sentiment } as never,
        { modelUsed: input.analysis.modelUsed, reasoning: input.analysis.reason },
      );

      await tx
        .insert(emailAnalyses)
        .values(record)
        .onConflictDoUpdate({
          target: [emailAnalyses.emailId, emailAnalyses.analysisType],
          set: {
            result: record.result,
            sentimentValue: record.sentimentValue,
            modelUsed: record.modelUsed,
            reasoning: record.reasoning,
            updatedAt: new Date(),
          },
        });

      logger.info(
        { tenantId: input.tenantId, emailId, threadId, model: input.analysis.modelUsed },
        'live save: message and reading stored from the panel',
      );

      return { emailId, threadId, sentiment: input.analysis.sentiment };
    });
  }
}

export interface LiveSaveInput {
  tenantId: string;
  /** Required, never defaulted — see the class comment. */
  integrationId: string;
  provider: string;
  thread: { providerThreadId: string; subject: string };
  email: {
    messageId: string;
    rfcMessageId?: string | null;
    subject: string;
    body: string;
    fromEmail: string;
    fromName?: string | null;
    tos?: string[];
    ccs?: string[];
    receivedAt: string;
  };
  analysis: {
    sentiment: 'positive' | 'neutral' | 'negative';
    reason: string;
    modelUsed: string;
  };
}

export interface LiveSaveResult {
  emailId: string;
  threadId: string;
  sentiment: string;
}
