import { injectable, inject } from 'tsyringe';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import { emails, emailThreads } from './schema';
import { emailAnalyses } from './analysis-schema';
import { integrations } from '../integrations/schema';
import { getEnv } from '../env';
import { logger } from '../utils/logger';

/**
 * The retrieval half of the context drop bar.
 *
 * The analysis half stores a Gmail query per email (`analysis_type =
 * 'context-search-string'`). This runs that query against the reader's live
 * mailbox and returns what it finds, so the sidebar can offer threads that give
 * context for the one on screen.
 *
 * BOUNDARY NOTE: Gmail data access belongs in crm-gmail, not here. It lives in
 * crm-api for now because crm-api already owns the `integrations` table and
 * already speaks to Google directly in the OAuth flow, and because routing this
 * through crm-gmail would mean standing up a second service for a feature that
 * is still being shaped. Move it when the search grows past one call.
 *
 * Read-only against Gmail. Nothing here writes to the mailbox or the database.
 */

/** One retrieved message, flattened to what the drop bar renders. */
export interface ContextCandidate {
  /** Gmail message id. */
  messageId: string;
  /** Gmail thread id — what navigation opens. */
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface ThreadContextResult {
  /** What the analysis decided would count as useful context here. */
  intent: string | null;
  /** The query actually run, after sanitization at analysis time. */
  query: string | null;
  candidates: ContextCandidate[];
  /** Set when there is nothing to show, explaining which step came up empty. */
  reason?: string;
}

/** How many candidates the drop bar shows. */
const MAX_CANDIDATES = 5;
/** Fetched before filtering, since most of a result set is the open thread. */
const SEARCH_LIMIT = 20;

interface StoredQuery {
  intent: string | null;
  query: string | null;
  providerThreadId: string;
}

@injectable()
export class ContextSearchService {
  constructor(@inject('Database') private db: Database) {}

  /**
   * The stored query for a thread, taken from its most recent analyzed message.
   *
   * Most recent rather than merged across the thread: the query is written to
   * answer one message, and the reader is looking at the newest one.
   */
  private async getStoredQuery(
    tenantId: string,
    threadId: string
  ): Promise<StoredQuery | null> {
    const rows = await this.db
      .select({
        result: emailAnalyses.result,
        providerThreadId: emailThreads.providerThreadId,
      })
      .from(emailAnalyses)
      .innerJoin(emails, eq(emails.id, emailAnalyses.emailId))
      .innerJoin(emailThreads, eq(emailThreads.id, emails.threadId))
      .where(
        and(
          eq(emailAnalyses.tenantId, tenantId),
          eq(emailAnalyses.analysisType, 'context-search-string'),
          eq(emails.threadId, threadId)
        )
      )
      .orderBy(desc(emails.receivedAt))
      .limit(1);

    if (rows.length === 0) return null;

    const result = rows[0].result as { intent?: string; query?: string } | null;
    return {
      intent: result?.intent ?? null,
      query: result?.query ?? null,
      providerThreadId: rows[0].providerThreadId,
    };
  }

  /**
   * Exchange a stored refresh token for an access token.
   *
   * Prefers the integration whose configured mailbox matches the viewer: a
   * tenant can have several active Gmail integrations, and searching the wrong
   * one returns a stranger's mail rather than nothing, which is worse.
   */
  private async getAccessToken(
    tenantId: string,
    viewerEmail?: string
  ): Promise<string | null> {
    const rows = await this.db
      .select({
        parameters: integrations.parameters,
        refreshToken: integrations.refreshToken,
        token: integrations.token,
      })
      .from(integrations)
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.source, 'gmail')));

    const mailboxOf = (parameters: unknown): string =>
      String(
        (Array.isArray(parameters) ? parameters : []).find(
          (p: { key?: string }) => p?.key === 'email'
        )?.value ?? ''
      ).toLowerCase();

    const wanted = viewerEmail?.toLowerCase();
    const ordered = [...rows].sort((a, b) => {
      const aMatch = wanted && mailboxOf(a.parameters) === wanted ? 0 : 1;
      const bMatch = wanted && mailboxOf(b.parameters) === wanted ? 0 : 1;
      return aMatch - bMatch;
    });

    const env = getEnv();
    for (const row of ordered) {
      const refreshToken = row.refreshToken ?? row.token;
      if (!refreshToken) continue;

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      if (!res.ok) continue; // dead grant — try the next integration

      const body = (await res.json()) as { access_token?: string };
      if (body.access_token) return body.access_token;
    }

    return null;
  }

  private async gmail<T>(path: string, token: string): Promise<T | null> {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  }

  /**
   * Run a thread's stored query and return the threads worth reading alongside it.
   *
   * The open thread is dropped from the results. It is not an edge case: a query
   * built from this email's own participants and subject matches its own thread
   * first, and measured against a real mailbox roughly two thirds of every
   * result set was the conversation already on screen.
   */
  async getThreadContext(
    requestHeader: RequestHeader,
    threadId: string,
    viewerEmail?: string
  ): Promise<ThreadContextResult> {
    const { tenantId } = requestHeader;

    const stored = await this.getStoredQuery(tenantId, threadId);
    if (!stored?.query) {
      return {
        intent: stored?.intent ?? null,
        query: null,
        candidates: [],
        reason: 'No context search has been generated for this conversation yet.',
      };
    }

    const token = await this.getAccessToken(tenantId, viewerEmail);
    if (!token) {
      return {
        intent: stored.intent,
        query: stored.query,
        candidates: [],
        reason: 'Gmail is not connected. Reconnect the mailbox to search for context.',
      };
    }

    const list = await this.gmail<{ messages?: Array<{ id: string; threadId: string }> }>(
      `messages?q=${encodeURIComponent(stored.query)}&maxResults=${SEARCH_LIMIT}`,
      token
    );

    const hits = (list?.messages ?? []).filter((m) => m.threadId !== stored.providerThreadId);
    if (hits.length === 0) {
      return {
        intent: stored.intent,
        query: stored.query,
        candidates: [],
        reason: 'Nothing outside this conversation matched.',
      };
    }

    // One thread per row: several messages of the same other thread are one
    // piece of context, not several.
    const seenThreads = new Set<string>();
    const candidates: ContextCandidate[] = [];

    for (const hit of hits) {
      if (candidates.length >= MAX_CANDIDATES) break;
      if (seenThreads.has(hit.threadId)) continue;
      seenThreads.add(hit.threadId);

      const meta = await this.gmail<{
        snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      }>(
        `messages/${hit.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        token
      );
      if (!meta) continue;

      const header = (name: string): string =>
        meta.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
        '';

      candidates.push({
        messageId: hit.id,
        threadId: hit.threadId,
        subject: header('Subject') || '(no subject)',
        from: header('From'),
        date: header('Date'),
        snippet: meta.snippet ?? '',
      });
    }

    logger.info(
      { tenantId, threadId, returned: candidates.length, searched: hits.length },
      'Context search completed'
    );

    return { intent: stored.intent, query: stored.query, candidates };
  }
}
