/**
 * Manual backfill: pull the last N days of Gmail messages from the tenant's
 * ACTIVE gmail integration (emailsentiment@ — the only mailbox with a live
 * token) and upload them into the clone DB via the API's bulk-insert path.
 *
 * Reuses the production SyncService (listing + blacklist filter + parse +
 * bulkInsertWithThreads + TAT reply markers). Does NOT advance the live
 * incremental cursor (syncSince passes advanceCheckpoint:false).
 *
 * Env: loads apps/gmail/.env.local then .env, then FORCES SERVICE_API_KEY to the
 * running API's key so internal calls authenticate against the clone-pointed API.
 *
 * Run from apps/gmail:
 *   SINCE_DAYS=7 API_SERVICE_KEY=<apiKey> bun scripts/backfill-week.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

// The running API validates internal calls against ITS SERVICE_API_KEY
// (apps/api/.env.local). The gmail env carries a stale key — override it.
if (process.env.API_SERVICE_KEY) {
  process.env.SERVICE_API_KEY = process.env.API_SERVICE_KEY;
}

import { IntegrationClient, RunClient, EmailClient } from '@crm/clients';
import { SyncService } from '../src/services/sync';
import { GmailClientFactory } from '../src/services/gmail-client-factory';
import { GmailService } from '../src/services/gmail';
import { EmailParserService } from '../src/services/email-parser';

const TENANT_ID = process.env.PROBE_TENANT_ID ?? '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';
const SINCE_DAYS = Number(process.env.SINCE_DAYS ?? '7');

async function main(): Promise<void> {
  const apiBaseUrl = process.env.SERVICE_API_URL as string;
  console.log(`API=${apiBaseUrl} tenant=${TENANT_ID} sinceDays=${SINCE_DAYS} keyLen=${process.env.SERVICE_API_KEY?.length}`);

  const integrationClient = new IntegrationClient(apiBaseUrl, { internal: true });
  const runClient = new RunClient(apiBaseUrl, { internal: true });
  const emailClient = new EmailClient(apiBaseUrl, { internal: true });
  const gmailClientFactory = new GmailClientFactory(integrationClient);
  const gmailService = new GmailService(gmailClientFactory);
  const emailParser = new EmailParserService();
  const syncService = new SyncService(integrationClient, runClient, emailClient, gmailService, emailParser);

  const integration = await integrationClient.getByTenantAndSource(TENANT_ID, 'gmail');
  if (!integration) throw new Error(`No active gmail integration for tenant ${TENANT_ID}`);
  const emailParam = (integration.parameters ?? []).find((p) => p.key === 'email');
  console.log(`Active integration ${integration.id} mailbox=${JSON.stringify(emailParam?.value)}`);

  const run = await runClient.create({
    integrationId: integration.id,
    tenantId: TENANT_ID,
    runType: 'historical',
    status: 'running',
  });
  console.log(`Run ${run.id} created — starting ${SINCE_DAYS}-day backfill...`);

  const result = await syncService.syncSince(integration, run.id, SINCE_DAYS);
  console.log('BACKFILL RESULT:', JSON.stringify(result));
  process.exit(0);
}

main().catch((e) => {
  console.error('BACKFILL FAILED:', e);
  process.exit(1);
});
