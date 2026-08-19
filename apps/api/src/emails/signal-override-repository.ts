import { injectable, inject } from 'tsyringe';
import type { Database, Transaction } from '@crm/database';
import { emailSignalOverrides, type NewEmailSignalOverride } from './signal-override-schema';

@injectable()
export class EmailSignalOverrideRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Append an override record to the audit/learning log.
   */
  async insert(override: NewEmailSignalOverride, tx?: Transaction): Promise<void> {
    const db = tx ?? this.db;
    await db.insert(emailSignalOverrides).values(override);
  }
}
