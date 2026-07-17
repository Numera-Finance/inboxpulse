import { Hono } from 'hono';
import { container } from 'tsyringe';
import { z } from 'zod';
import { EmailService } from './service';
import { EmailAnalysisService } from './analysis-service';
import { RunService } from '../runs/service';
import { dbEmailToEmail } from './converter';
import { buildThreadContext } from './thread-context';
import type { NewEmail } from './schema';
import { emailCollectionSchema, type EmailCollection, type AnalysisType, type RequestHeader, InvalidInputError, InternalError, NotFoundError, ValidationError } from '@crm/shared';
import { analyzedEmailSearchRequestSchema, firstReplyMarkersRequestSchema, updateEmailSignalsRequestSchema } from '@crm/clients';
import { logger } from '../utils/logger';
import { handleApiRequest, handleGetRequest, handleGetRequestWithParams, handleApiRequestWithParams } from '../utils/api-handler';

const app = new Hono();

/**
 * Bulk insert emails with threads (new provider-agnostic format)
 * Stores emails synchronously and updates run status synchronously
 * If storage fails, returns 500 for Pub/Sub retry
 */
app.post('/bulk-with-threads', async (c) => {
  const body = await c.req.json<{
    tenantId: string;
    integrationId: string; // Required - provider derived from integration
    emailCollections: EmailCollection[];
    runId?: string; // Optional - for tracking run status updates
  }>();

  // Validate request body structure
  if (!body.tenantId || !body.integrationId || !body.emailCollections) {
    throw new InvalidInputError('tenantId, integrationId, and emailCollections are required');
  }

  // Validate email collections array
  const validationResult = emailCollectionSchema.array().safeParse(body.emailCollections);
  if (!validationResult.success) {
    throw new ValidationError(
      'Invalid email collections',
      { issues: validationResult.error.issues },
      validationResult.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message, code: i.code }))
    );
  }

  // Force every bulk-insert failure to surface as 500 so Pub/Sub redelivers.
  // Without this wrap, the global handler would map postgres FK / unique /
  // NOT NULL violations (23503 / 23505 / 23502) to 4xx, which Pub/Sub treats
  // as permanent — losing the retry on transient DB issues.
  const emailService = container.resolve(EmailService);
  let result: Awaited<ReturnType<typeof emailService.bulkInsertWithThreads>>;
  try {
    result = await emailService.bulkInsertWithThreads(
      body.tenantId,
      body.integrationId,
      validationResult.data
    );
  } catch (error) {
    throw new InternalError(
      'Bulk insert failed',
      { tenantId: body.tenantId, integrationId: body.integrationId },
      error instanceof Error ? error : new Error(String(error))
    );
  }

  logger.info(
    {
      tenantId: body.tenantId,
      integrationId: body.integrationId,
      runId: body.runId,
      insertedCount: result.insertedCount,
      skippedCount: result.skippedCount,
      threadsCreated: result.threadsCreated,
    },
    'Bulk insert completed successfully'
  );

  // Update run status if runId provided. Fail-soft: emails are already stored,
  // so a run-update failure shouldn't propagate as a 500 (which would make
  // Pub/Sub redeliver and re-insert).
  if (body.runId) {
    try {
      const runService = container.resolve(RunService);
      await runService.update(body.runId, {
        status: 'completed',
        itemsProcessed: result.insertedCount + result.skippedCount,
        itemsInserted: result.insertedCount,
        itemsSkipped: result.skippedCount,
        completedAt: new Date(),
      });
      logger.info({ tenantId: body.tenantId, runId: body.runId }, 'Run status updated successfully');
    } catch (runUpdateError) {
      logger.error(
        { error: runUpdateError, tenantId: body.tenantId, runId: body.runId },
        'Failed to update run status (emails already stored)'
      );
    }
  }

  return c.json(result);
});

/**
 * Record first-reply markers (header-only) for outbound/reply messages the Gmail
 * sync drops at the blacklist stage. Sets first_reply_at on the answered customer
 * emails. No email rows are created. Best-effort: the caller (sync) does not fail
 * if this errors, but invalid bodies still return 4xx.
 */
app.post('/first-reply-markers', async (c) => {
  const body = await c.req.json();

  const parsed = firstReplyMarkersRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid first-reply markers request',
      { issues: parsed.error.issues },
      parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message, code: i.code }))
    );
  }

  const emailService = container.resolve(EmailService);
  const result = await emailService.applyFirstReplyMarkers(
    parsed.data.tenantId,
    parsed.data.integrationId,
    parsed.data.markers
  );

  logger.info(
    {
      tenantId: parsed.data.tenantId,
      integrationId: parsed.data.integrationId,
      markerCount: parsed.data.markers.length,
      updatedCount: result.updatedCount,
    },
    'Applied first-reply markers'
  );

  return c.json(result);
});

/**
 * Bulk insert emails (legacy endpoint for backward compatibility)
 */
app.post('/bulk', async (c) => {
  const { emails } = await c.req.json<{ emails: NewEmail[] }>();

  const emailService = container.resolve(EmailService);
  const result = await emailService.bulkInsert(emails);
  return c.json(result);
});

/**
 * GET /api/emails - List emails for tenant (with access control)
 */
app.get('/', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const service = container.resolve(EmailService);
    return await service.findByTenantScoped(requestHeader, { limit, offset });
  });
});

/**
 * GET /api/emails/stats - Get dashboard email statistics (with access control)
 * Query params:
 *   - customerId: string (optional) - filter by customer
 *   - from: string (optional) - start date ISO string
 *   - to: string (optional) - end date ISO string
 */
app.get('/stats', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const customerId = c.req.query('customerId');
    const dateFrom = c.req.query('from');
    const dateTo = c.req.query('to');
    const service = container.resolve(EmailService);
    return await service.getDashboardStats(requestHeader, {
      customerId: customerId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  });
});

/**
 * GET /api/emails/sentiment-stats - Get sentiment distribution for dashboard (with access control)
 * Query params:
 *   - customerId: string (optional) - filter by customer
 *   - from: string (optional) - start date ISO string
 *   - to: string (optional) - end date ISO string
 */
app.get('/sentiment-stats', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const customerId = c.req.query('customerId');
    const dateFrom = c.req.query('from');
    const dateTo = c.req.query('to');
    const service = container.resolve(EmailService);
    return await service.getSentimentStats(requestHeader, {
      customerId: customerId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  });
});

/**
 * GET /api/emails/sentiment-trend - Get sentiment trend data for dashboard (with access control)
 * Returns monthly percentages over last 6 months
 * Query params:
 *   - customerId: string (optional) - filter by customer
 */
app.get('/sentiment-trend', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const customerId = c.req.query('customerId');
    const service = container.resolve(EmailService);
    return await service.getSentimentTrend(requestHeader, {
      customerId: customerId || undefined,
    });
  });
});

/**
 * GET /api/emails/volume-trend - Get email volume trend data for dashboard (with access control)
 * Returns weekly counts for last 4 weeks
 * Query params:
 *   - customerId: string (optional) - filter by customer
 */
app.get('/volume-trend', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const customerId = c.req.query('customerId');
    const service = container.resolve(EmailService);
    return await service.getEmailVolumeTrend(requestHeader, {
      customerId: customerId || undefined,
    });
  });
});

/**
 * GET /api/emails/upsell-count - Get upsell opportunity count for dashboard (with access control)
 * Query params:
 *   - customerId: string (optional) - filter by customer
 *   - from: string (optional) - start date ISO string
 *   - to: string (optional) - end date ISO string
 */
app.get('/upsell-count', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const customerId = c.req.query('customerId');
    const dateFrom = c.req.query('from');
    const dateTo = c.req.query('to');
    const service = container.resolve(EmailService);
    return await service.getUpsellCount(requestHeader, {
      customerId: customerId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  });
});

/**
 * GET /api/emails/tat-metrics - Get TAT (Turn Around Time) metrics for dashboard
 * Returns SLA breach counts grouped by customer and controller
 *
 * TAT buckets:
 *   - 1+ Days: 1-2 business days
 *   - 2+ Days: 2-3 business days
 *   - 3+ Days: 3-5 business days
 *   - 5+ Days: 5-6 business days
 *   - 6+ Days: 6+ business days
 *
 * Query params:
 *   - customerId: string (optional) - filter by customer
 *   - from: string (optional) - start date ISO string
 *   - to: string (optional) - end date ISO string
 */
app.get('/tat-metrics', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const customerId = c.req.query('customerId');
    const dateFrom = c.req.query('from');
    const dateTo = c.req.query('to');
    const service = container.resolve(EmailService);
    return await service.getTATMetrics(requestHeader, {
      customerId: customerId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  });
});

/**
 * POST /api/emails/analyzed/search - Search analyzed emails with task overlay
 * Returns paginated list of analyzed emails with optional task information
 */
app.post('/analyzed/search', async (c) => {
  return handleApiRequest(c, analyzedEmailSearchRequestSchema, async (requestHeader: RequestHeader, request) => {
    const service = container.resolve(EmailService);
    return await service.searchAnalyzedEmails(requestHeader, request);
  });
});

/**
 * POST /api/emails/analyzed/export - Export analyzed emails with comments and contact roles
 * Same filters as search, but returns all matching results (no pagination)
 */
app.post('/analyzed/export', async (c) => {
  return handleApiRequest(c, analyzedEmailSearchRequestSchema, async (requestHeader: RequestHeader, request) => {
    const service = container.resolve(EmailService);
    return await service.exportAnalyzedEmails(requestHeader, request);
  });
});

/**
 * GET /api/emails/analyzed/:emailId - Get single analyzed email with task overlay
 */
app.get('/analyzed/:emailId', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ emailId: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(EmailService);
      const email = await service.getAnalyzedEmailById(requestHeader, params.emailId);
      if (!email) {
        throw new NotFoundError('Email', params.emailId);
      }
      return email;
    }
  );
});

/**
 * GET /api/emails/customer/:customerId - Get emails by customer (with access control)
 * Query params:
 *   - limit: number (default 50)
 *   - offset: number (default 0)
 *   - sentiment: 'positive' | 'negative' | 'neutral' (filter by sentiment)
 *   - escalation: 'true' (filter for escalated emails only)
 *   - signal: 'upsell' | 'churn' (filter by specific signal)
 *   - tatViolation: 'true' (filter for emails with TAT/SLA violations > 1 day)
 *   - dateFrom: ISO date string (filter for TAT violations)
 *   - dateTo: ISO date string (filter for TAT violations)
 */
app.get('/customer/:customerId', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ customerId: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const limit = parseInt(c.req.query('limit') || '50');
      const offset = parseInt(c.req.query('offset') || '0');
      const sentiment = c.req.query('sentiment') as 'positive' | 'negative' | 'neutral' | undefined;
      const escalation = c.req.query('escalation') === 'true';
      const signal = c.req.query('signal') as 'upsell' | 'churn' | undefined;
      const tatViolation = c.req.query('tatViolation') === 'true';
      const dateFrom = c.req.query('dateFrom') || undefined;
      const dateTo = c.req.query('dateTo') || undefined;
      const query = c.req.query('query') || undefined;
      const service = container.resolve(EmailService);
      return await service.findByCustomerScoped(requestHeader, params.customerId, {
        limit,
        offset,
        sentiment,
        escalation,
        signal,
        tatViolation,
        dateFrom,
        dateTo,
        query,
      });
    }
  );
});

/**
 * POST /api/emails/resolve-by-messages - Resolve emails by provider message IDs.
 * Returns each matched email's linked customer and sentiment signals so the Gmail
 * extension can map an open thread to a customer authoritatively (by the stored
 * email→customer link) rather than guessing from the sender's domain.
 *
 * Authorization: like every other email read route, this is gated by the session
 * middleware (authenticated user + tenant) plus per-row access control inside
 * findByMessageIdsScoped (customerAccessFilter) — it only ever returns emails for
 * customers the caller can access. There is no read-level Permission in the RBAC
 * model, so no requirePermission() is applied (consistent with GET /api/emails/*).
 */
app.post('/resolve-by-messages', async (c) => {
  return handleApiRequest(
    c,
    z.object({
      messageIds: z.array(z.string()).min(1).max(100),
      provider: z.string().optional(),
    }),
    async (requestHeader: RequestHeader, body) => {
      const service = container.resolve(EmailService);
      const emails = await service.resolveByMessageIds(
        requestHeader,
        body.provider ?? 'gmail',
        body.messageIds
      );
      return { emails };
    }
  );
});

/**
 * GET /api/emails/:emailId - Get email by ID (with access control)
 */
app.get('/:emailId', async (c) => {
  // Skip this route for specific paths that should be handled by other routes
  const emailId = c.req.param('emailId');
  if (emailId === 'exists' || emailId === 'thread' || emailId === 'bulk' || emailId === 'bulk-with-threads' || emailId === 'analyzed') {
    return c.notFound();
  }

  return handleGetRequestWithParams(
    c,
    z.object({ emailId: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(EmailService);
      const email = await service.findByIdScoped(requestHeader, params.emailId);
      if (!email) {
        throw new NotFoundError('Email', params.emailId);
      }
      return email;
    }
  );
});

/**
 * Check if email exists (internal/system use)
 */
app.get('/exists', async (c) => {
  const tenantId = c.req.query('tenantId');
  const provider = c.req.query('provider') || 'gmail';
  const messageId = c.req.query('messageId');

  if (!tenantId) throw new InvalidInputError('tenantId query parameter is required');
  if (!messageId) throw new InvalidInputError('messageId query parameter is required');

  const emailService = container.resolve(EmailService);
  const exists = await emailService.exists(tenantId, provider, messageId);
  return c.json({ exists });
});

/**
 * Analyze an existing email on demand
 * POST /api/emails/:emailId/analyze?persist=true&analysisTypes=sentiment,escalation,churn
 * 
 * Query params:
 * - persist: boolean (default: false) - Whether to save results to database
 * - analysisTypes: comma-separated list (optional) - Which analyses to run (e.g., "sentiment,escalation,churn")
 *   If not provided, uses analysis service defaults (excludes domain-extraction and contact-extraction)
 * 
 * Note: tenantId is retrieved from the email record, no need to pass it
 */
app.post('/:emailId/analyze', async (c) => {
  const emailId = c.req.param('emailId');
  const persist = c.req.query('persist') === 'true';
  const analysisTypesParam = c.req.query('analysisTypes');

  // Parse analysisTypes from comma-separated string
  let analysisTypes: AnalysisType[] | undefined;
  if (analysisTypesParam) {
    const parsedTypes = analysisTypesParam.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    if (parsedTypes.length > 0) {
      analysisTypes = parsedTypes as AnalysisType[];
    }
  }

  const emailService = container.resolve(EmailService);
  const analysisService = container.resolve(EmailAnalysisService);

  // Fetch email from database (by ID only - tenantId is in the email record)
  const dbEmail = await emailService.findById(emailId);
  if (!dbEmail) throw new NotFoundError('Email', emailId);

  // Get tenantId from the email record
  const tenantId = dbEmail.tenantId;

  // Get thread emails for context
  const threadResult = await emailService.findByThread(tenantId, dbEmail.threadId);

  // Build thread context (same logic as Inngest function)
  const threadContext = buildThreadContext(threadResult.emails, dbEmail.messageId);

  // Convert DB email to shared Email type
  const email = dbEmailToEmail(dbEmail);

  logger.info(
    { tenantId, emailId, persist, threadEmailsCount: threadResult.emails.length },
    'Starting on-demand email analysis'
  );

  // Execute analysis using shared service.
  // Note: threadContext is built from raw emails; the service will prefer
  // thread summaries when available.
  const result = await analysisService.executeAnalysis({
    tenantId,
    emailId,
    email,
    threadId: dbEmail.threadId,
    threadContext: threadContext.threadContext,
    persist,
    analysisTypes,
    useThreadSummaries: false, // Disabled - thread summaries not used in UI yet
  });

  return c.json({
    success: true,
    emailId,
    persist,
    result: {
      customersCreated: result.customers?.length || 0,
      contactsCreated: result.contacts?.length || 0,
      analyses: result.analysisResults || {},
      customers: result.customers || [],
      contacts: result.contacts || [],
    },
  });
});

/**
 * Manually override an email's signals (sentiment / churn / tags)
 * PATCH /api/emails/:emailId/signals
 *
 * Body: { signals: number[]; reason?: string }
 *
 * Replaces the email's signal set with the user-supplied one, locks it against
 * future re-analysis, and records the before/after in the override audit log.
 * Available to any user with email access (authed /api/emails mount only).
 */
app.patch('/:emailId/signals', async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ emailId: z.string().uuid() }),
    updateEmailSignalsRequestSchema,
    async (requestHeader, params, request) => {
      const analysisService = container.resolve(EmailAnalysisService);
      return await analysisService.applyManualSignalOverride(
        requestHeader,
        params.emailId,
        request.signals,
        request.reason
      );
    }
  );
});

export default app;
