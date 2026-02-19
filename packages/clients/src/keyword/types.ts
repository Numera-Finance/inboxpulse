import { z } from 'zod';

export const keywordCategorySchema = z.enum([
  'sentiment_positive',
  'sentiment_negative',
  'escalation',
  'upsell',
  'churn',
  'kudos',
  'competitor',
]);

export type KeywordCategory = z.infer<typeof keywordCategorySchema>;

export const saveKeywordsRequestSchema = z.object({
  keywords: z.string(),
});

export type SaveKeywordsRequest = z.infer<typeof saveKeywordsRequestSchema>;

export const keywordEntrySchema = z.object({
  category: z.string(),
  keywords: z.string(),
});

export type KeywordEntry = z.infer<typeof keywordEntrySchema>;
