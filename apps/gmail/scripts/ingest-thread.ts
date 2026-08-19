/**
 * Ingest specific Gmail thread(s) into the clone DB, BYPASSING the sync-layer
 * blacklist — so internal (tenant-domain) threads the normal sync drops can be
 * pulled in on demand.
 *
 * Fetches each thread's full messages via the mailbox's token, parses them with
 * the same EmailParserService the sync uses, and inserts via the API's
 * bulk-with-threads endpoint. Does NOT touch analysis — run the analyze step
 * afterward.
 *
 * The mailbox is whichever gmail integration is ACTIVE for the tenant, so
 * isolate the target mailbox first (scripts/set-active-mailbox.ts in apps/api).
 *
 * Run from apps/gmail:
 *   API_SERVICE_KEY=<apiKey> THREAD_IDS=19f80e30f0b35893 bun scripts/ingest-thread.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

if (process.env.API_SERVICE_KEY) process.env.SERVICE_API_KEY = process.env.API_SERVICE_KEY;

import { IntegrationClient, EmailClient } from '@crm/clients';
import { GmailClientFactory } from '../src/services/gmail-client-factory';
import { EmailParserService } from '../src/services/email-parser';
import type { gmail_v1 } from 'googleapis';

const TENANT_ID = process.env.PROBE_TENANT_ID ?? '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';
const THREAD_IDS = (process.env.THREAD_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function main(): Promise<void> {
  if (THREAD_IDS.length === 0) throw new Error('Set THREAD_IDS=<id,id,...>');
  const apiBaseUrl = process.env.SERVICE_API_URL as string;

  const integrationClient = new IntegrationClient(apiBaseUrl, { internal: true });
  const emailClient = new EmailClient(apiBaseUrl, { internal: true });
  const factory = new GmailClientFactory(integrationClient);
  const parser = new EmailParserService();

  const integration = await integrationClient.getByTenantAndSource(TENANT_ID, 'gmail');
  if (!integration) throw new Error('no active gmail integration');
  const emailParam = (integration.parameters ?? []).find((p) => p.key === 'email');
  console.log(`Active mailbox = ${JSON.stringify(emailParam?.value)} (integration ${integration.id})`);

  const gmail = await factory.getClient(TENANT_ID);

  const allMessages: gmail_v1.Schema$Message[] = [];
  for (const tid of THREAD_IDS) {
    const th = await gmail.users.threads.get({ userId: 'me', id: tid, format: 'full' });
    const msgs = th.data.messages ?? [];
    console.log(`  thread ${tid}: ${msgs.length} message(s)`);
    allMessages.push(...msgs);
  }

  const collections = parser.parseMessages(allMessages, 'gmail');
  const totalEmails = collections.reduce((n, c) => n + c.emails.length, 0);
  console.log(`Parsed ${totalEmails} email(s) across ${collections.length} collection(s). Inserting...`);

  const result = await emailClient.bulkInsertWithThreads(TENANT_ID, integration.id, collections);
  console.log('INSERT RESULT:', JSON.stringify(result));
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : e); process.exit(1); });
