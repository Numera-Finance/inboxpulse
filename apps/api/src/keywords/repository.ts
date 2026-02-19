import { eq, and } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import { analysisKeywords, type AnalysisKeyword } from './schema';
import { logger } from '../utils/logger';

@injectable()
export class KeywordRepository {
  constructor(@inject('Database') private db: Database) {}

  async getByTenant(tenantId: string): Promise<AnalysisKeyword[]> {
    return this.db
      .select()
      .from(analysisKeywords)
      .where(eq(analysisKeywords.tenantId, tenantId));
  }

  async upsert(
    tenantId: string,
    category: string,
    keywords: string
  ): Promise<AnalysisKeyword> {
    const result = await this.db
      .insert(analysisKeywords)
      .values({ tenantId, category, keywords })
      .onConflictDoUpdate({
        target: [analysisKeywords.tenantId, analysisKeywords.category],
        set: { keywords, updatedAt: new Date() },
      })
      .returning();

    logger.info(
      { tenantId, category, keywordCount: keywords.split('\n').filter(k => k.trim()).length },
      'Upserted analysis keywords'
    );

    return result[0];
  }
}
