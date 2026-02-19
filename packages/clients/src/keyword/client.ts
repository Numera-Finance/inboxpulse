import { AuthBaseClient } from '../base-client';
import type { ApiResponse } from '@crm/shared';
import type { KeywordEntry, KeywordCategory } from './types';

export class KeywordClient extends AuthBaseClient {
  async getAll(signal?: AbortSignal): Promise<KeywordEntry[]> {
    const response = await this.get<ApiResponse<KeywordEntry[]>>('/api/keywords', signal);
    return response?.data || [];
  }

  async save(category: KeywordCategory, keywords: string, signal?: AbortSignal): Promise<void> {
    await this.put<ApiResponse<{ success: boolean }>>(
      `/api/keywords/${encodeURIComponent(category)}`,
      { keywords },
      signal
    );
  }
}
