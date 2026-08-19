/**
 * Probe which Gmail mailboxes we can actually reach for a tenant.
 *
 * The tenant has many `integrations` rows for gmail; only one is `is_active`,
 * and every code path (getCredentials / findByEmail) filters on is_active.
 * This script ignores that filter, and for each row reports whether its stored
 * refresh token still exchanges for an access token and whose mailbox it opens.
 *
 * Never prints token material — only lengths, scopes and the resolved address.
 *
 * Run from apps/api:
 *   bun ../../scripts/inbox/probe-mailbox-auth.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createDatabase, sql } from '@crm/database';

const TENANT_ID = process.env.PROBE_TENANT_ID ?? '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';

interface IntegrationRow {
  id: string;
  parameters: Array<{ key: string; value: unknown }>;
  refresh_token: string | null;
  token: string | null;
  is_active: boolean;
  last_run_at: Date | null;
}

interface ProbeResult {
  id: string;
  configuredEmail: string;
  isActive: boolean;
  lastRunAt: string | null;
  refresh: 'ok' | 'failed' | 'no-token';
  refreshError?: string;
  scopes?: string[];
  mailbox?: string;
  messagesTotal?: number;
}

async function main(): Promise<void> {
  const db = createDatabase({});
  const rows = (await db.execute(sql`
    SELECT id, parameters, refresh_token, token, is_active, last_run_at
    FROM integrations
    WHERE tenant_id = ${TENANT_ID} AND source = 'gmail'
    ORDER BY is_active DESC, last_run_at DESC NULLS LAST
  `)) as unknown as IntegrationRow[];

  const clientId = process.env.GOOGLE_CLIENT_ID as string;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET as string;
  console.log(`clientId=${clientId?.split('-')[0]}… secretLen=${clientSecret?.length ?? 0} rows=${rows.length}\n`);

  const results: ProbeResult[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const params = Object.fromEntries((row.parameters ?? []).map((p) => [p.key, p.value]));
    const configuredEmail = String(params.email ?? '(none)');
    const refreshToken = row.refresh_token ?? row.token;

    const base: ProbeResult = {
      id: row.id,
      configuredEmail,
      isActive: row.is_active,
      lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
      refresh: 'no-token',
    };

    if (!refreshToken) {
      results.push(base);
      continue;
    }
    // Same refresh token reused across rows — only probe each token once.
    const fingerprint = `${refreshToken.slice(0, 12)}:${refreshToken.length}`;
    if (seen.has(fingerprint)) {
      results.push({ ...base, refresh: 'failed', refreshError: 'duplicate token (already probed)' });
      continue;
    }
    seen.add(fingerprint);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenRes.ok) {
      results.push({ ...base, refresh: 'failed', refreshError: (await tokenRes.text()).slice(0, 200) });
      continue;
    }

    const token = (await tokenRes.json()) as { access_token: string; scope?: string };
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const profile = profileRes.ok
      ? ((await profileRes.json()) as { emailAddress?: string; messagesTotal?: number })
      : {};

    results.push({
      ...base,
      refresh: 'ok',
      scopes: token.scope?.split(' '),
      mailbox: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
    });
  }

  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
