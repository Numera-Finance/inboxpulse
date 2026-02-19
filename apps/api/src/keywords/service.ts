import { injectable, inject } from 'tsyringe';
import { KeywordRepository } from './repository';
import { logger } from '../utils/logger';

const VALID_CATEGORIES = new Set([
  'sentiment_positive',
  'sentiment_negative',
  'escalation',
  'upsell',
  'churn',
  'kudos',
  'competitor',
]);

interface CacheEntry {
  data: Map<string, string[]>;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@injectable()
export class KeywordService {
  private cache = new Map<string, CacheEntry>();

  constructor(
    @inject(KeywordRepository) private keywordRepo: KeywordRepository
  ) {}

  async getKeywordsByTenant(tenantId: string): Promise<Map<string, string[]>> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const rows = await this.keywordRepo.getByTenant(tenantId);
    const map = new Map<string, string[]>();

    for (const row of rows) {
      const parsed = row.keywords
        .split('\n')
        .map(k => k.trim())
        .filter(k => k.length > 0);
      if (parsed.length > 0) {
        map.set(row.category, parsed);
      }
    }

    this.cache.set(tenantId, { data: map, expiresAt: Date.now() + CACHE_TTL_MS });
    return map;
  }

  async saveKeywords(tenantId: string, category: string, keywords: string): Promise<void> {
    if (!VALID_CATEGORIES.has(category)) {
      throw new Error(`Invalid keyword category: ${category}`);
    }

    await this.keywordRepo.upsert(tenantId, category, keywords);
    this.cache.delete(tenantId);

    logger.info({ tenantId, category }, 'Saved analysis keywords and cleared cache');
  }

  async getAllForTenant(tenantId: string): Promise<Array<{ category: string; keywords: string }>> {
    const rows = await this.keywordRepo.getByTenant(tenantId);
    return rows.map(r => ({ category: r.category, keywords: r.keywords }));
  }
}
