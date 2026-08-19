/**
 * Unit tests for user-submitted analysis tag suggestions.
 *
 * The contract that matters: a suggestion must land ONLY in the
 * user_submitted_* columns and must never touch the model's own verdict. These
 * tests pin that down at the service boundary (which analysis rows get written,
 * with what value) plus the request-schema rules, with the repositories mocked
 * so no database is needed.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitTagSuggestionRequestSchema } from '@crm/clients';
import type { RequestHeader } from '@crm/shared';
import { NotFoundError } from '@crm/shared';
import { EmailService } from './service';
import type { EmailRepository } from './repository';
import type { EmailAnalysisRepository } from './analysis-repository';
import type { EmailThreadRepository } from './thread-repository';
import type { TenantRepository } from '../tenants/repository';
import type { ContactRepository } from '../contacts/repository';
import type { Database } from '@crm/database';

// The real logger lazily `require`s ../env (validated startup config) the first
// time it's touched, which isn't resolvable under vitest's ESM transform.
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const TENANT_ID = '00000000-0000-0000-0000-0000000000a1';
const USER_ID = '00000000-0000-0000-0000-0000000000c1';
const EMAIL_ID = '00000000-0000-0000-0000-0000000000d1';
const MESSAGE_ID = 'gmail-msg-1';

const header: RequestHeader = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  permissions: [],
} as unknown as RequestHeader;

function mkService(overrides?: {
  match?: { id: string } | null;
  churn?: Record<string, unknown> | null;
  sentiment?: Record<string, unknown> | null;
}) {
  const match = overrides?.match === undefined ? { id: EMAIL_ID } : overrides.match;

  const emailRepo = {
    findByMessageIdsScoped: vi.fn().mockResolvedValue(match ? [match] : []),
  } as unknown as EmailRepository;

  const analysisRepo = {
    upsertUserSubmission: vi.fn().mockResolvedValue(undefined),
    getAnalysis: vi.fn(async (_emailId: string, type: string) =>
      type === 'churn' ? (overrides?.churn ?? null) : (overrides?.sentiment ?? null)
    ),
  } as unknown as EmailAnalysisRepository;

  const service = new EmailService(
    emailRepo,
    analysisRepo,
    {} as EmailThreadRepository,
    {} as TenantRepository,
    {} as ContactRepository,
    {} as Database
  );

  return { service, emailRepo, analysisRepo };
}

describe('submitTagSuggestionRequestSchema', () => {
  it('accepts a churn-only suggestion', () => {
    const parsed = submitTagSuggestionRequestSchema.parse({
      messageId: MESSAGE_ID,
      riskLevel: 'medium',
    });
    expect(parsed.riskLevel).toBe('medium');
    expect(parsed.sentimentValue).toBeUndefined();
  });

  it('accepts both groups at once', () => {
    const parsed = submitTagSuggestionRequestSchema.parse({
      messageId: MESSAGE_ID,
      riskLevel: 'medium',
      sentimentValue: 'negative',
    });
    expect(parsed).toMatchObject({ riskLevel: 'medium', sentimentValue: 'negative' });
  });

  it('accepts null as an explicit "clear this suggestion"', () => {
    const parsed = submitTagSuggestionRequestSchema.parse({
      messageId: MESSAGE_ID,
      riskLevel: null,
    });
    expect(parsed.riskLevel).toBeNull();
  });

  it('rejects a request that suggests nothing', () => {
    expect(() => submitTagSuggestionRequestSchema.parse({ messageId: MESSAGE_ID })).toThrow();
  });

  it('rejects values outside the allowed tag sets', () => {
    expect(() =>
      submitTagSuggestionRequestSchema.parse({ messageId: MESSAGE_ID, riskLevel: 'severe' })
    ).toThrow();
    expect(() =>
      submitTagSuggestionRequestSchema.parse({ messageId: MESSAGE_ID, sentimentValue: 'angry' })
    ).toThrow();
  });
});

describe('EmailService.submitTagSuggestion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the churn suggestion to the churn row only', async () => {
    const { service, analysisRepo } = mkService();

    await service.submitTagSuggestion(header, { messageId: MESSAGE_ID, riskLevel: 'medium' });

    expect(analysisRepo.upsertUserSubmission).toHaveBeenCalledTimes(1);
    expect(analysisRepo.upsertUserSubmission).toHaveBeenCalledWith(
      EMAIL_ID,
      TENANT_ID,
      'churn',
      'medium'
    );
  });

  it('writes the sentiment suggestion to the sentiment row only', async () => {
    const { service, analysisRepo } = mkService();

    await service.submitTagSuggestion(header, {
      messageId: MESSAGE_ID,
      sentimentValue: 'negative',
    });

    expect(analysisRepo.upsertUserSubmission).toHaveBeenCalledTimes(1);
    expect(analysisRepo.upsertUserSubmission).toHaveBeenCalledWith(
      EMAIL_ID,
      TENANT_ID,
      'sentiment',
      'negative'
    );
  });

  it('writes both rows when the user suggests a churn level and a sentiment', async () => {
    const { service, analysisRepo } = mkService();

    await service.submitTagSuggestion(header, {
      messageId: MESSAGE_ID,
      riskLevel: 'critical',
      sentimentValue: 'positive',
    });

    expect(analysisRepo.upsertUserSubmission).toHaveBeenCalledTimes(2);
    expect(analysisRepo.upsertUserSubmission).toHaveBeenNthCalledWith(
      1,
      EMAIL_ID,
      TENANT_ID,
      'churn',
      'critical'
    );
    expect(analysisRepo.upsertUserSubmission).toHaveBeenNthCalledWith(
      2,
      EMAIL_ID,
      TENANT_ID,
      'sentiment',
      'positive'
    );
  });

  it('leaves an omitted group untouched (no write for it)', async () => {
    const { service, analysisRepo } = mkService();

    await service.submitTagSuggestion(header, { messageId: MESSAGE_ID, riskLevel: 'low' });

    const types = (analysisRepo.upsertUserSubmission as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[2]
    );
    expect(types).toEqual(['churn']);
  });

  it('passes null through so a previous suggestion can be cleared', async () => {
    const { service, analysisRepo } = mkService();

    await service.submitTagSuggestion(header, { messageId: MESSAGE_ID, sentimentValue: null });

    expect(analysisRepo.upsertUserSubmission).toHaveBeenCalledWith(
      EMAIL_ID,
      TENANT_ID,
      'sentiment',
      null
    );
  });

  it('resolves the message through the access-controlled lookup', async () => {
    const { service, emailRepo } = mkService();

    await service.submitTagSuggestion(header, {
      messageId: MESSAGE_ID,
      provider: 'gmail',
      riskLevel: 'high',
    });

    expect(emailRepo.findByMessageIdsScoped).toHaveBeenCalledWith(
      header,
      'gmail',
      [MESSAGE_ID],
      []
    );
  });

  it('defaults the provider to gmail', async () => {
    const { service, emailRepo } = mkService();

    await service.submitTagSuggestion(header, { messageId: MESSAGE_ID, riskLevel: 'high' });

    expect(emailRepo.findByMessageIdsScoped).toHaveBeenCalledWith(
      header,
      'gmail',
      [MESSAGE_ID],
      []
    );
  });

  it('404s (and writes nothing) when the message is unknown or not accessible', async () => {
    const { service, analysisRepo } = mkService({ match: null });

    await expect(
      service.submitTagSuggestion(header, { messageId: 'nope', riskLevel: 'high' })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(analysisRepo.upsertUserSubmission).not.toHaveBeenCalled();
  });

  it('returns the persisted state read back from the analysis rows', async () => {
    const { service } = mkService({
      churn: { userSubmittedRiskLevel: 'medium' },
      // Sentiment was never suggested — the row exists but the column is null.
      sentiment: { userSubmittedSentimentValue: null },
    });

    const result = await service.submitTagSuggestion(header, {
      messageId: MESSAGE_ID,
      riskLevel: 'medium',
    });

    expect(result).toEqual({
      emailId: EMAIL_ID,
      messageId: MESSAGE_ID,
      userSubmittedRiskLevel: 'medium',
      userSubmittedSentimentValue: null,
    });
  });

  it('reports nulls when no analysis rows exist at all', async () => {
    const { service } = mkService({ churn: null, sentiment: null });

    const result = await service.submitTagSuggestion(header, {
      messageId: MESSAGE_ID,
      sentimentValue: 'neutral',
    });

    expect(result.userSubmittedRiskLevel).toBeNull();
    expect(result.userSubmittedSentimentValue).toBeNull();
  });
});
