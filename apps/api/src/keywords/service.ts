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

/**
 * Parse keyword string supporting quoted multi-word phrases and single words.
 * Handles both straight quotes ("...") and curly/smart quotes (\u201c...\u201d).
 * Examples:
 *   'urgent critical' → ['urgent', 'critical']
 *   '"well done" great' → ['well done', 'great']
 *   '\u201ccancel subscription\u201d churn' → ['cancel subscription', 'churn']
 */
export function parseKeywords(input: string): string[] {
  const keywords: string[] = [];
  // Match: straight-quoted phrase | curly-quoted phrase | unquoted word
  const regex = /"([^"]+)"|[\u201c\u201e\u201f]([^\u201d\u201c"]+)[\u201d\u201c"]|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    const value = (match[1] || match[2] || match[3]).trim();
    if (value.length > 0) {
      keywords.push(value);
    }
  }
  return keywords;
}

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
      const parsed = parseKeywords(row.keywords);
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
