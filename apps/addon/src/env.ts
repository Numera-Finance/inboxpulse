import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(4005),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  // InboxPulse API (called via the internal service path)
  SERVICE_API_URL: z.string().default('http://localhost:4001'),
  // Needed to call /api/internal/*. Blank => the add-on runs in "preview mode"
  // (renders cards with no live data) so the scaffold boots with zero config.
  SERVICE_API_KEY: z.string().default(''),

  // Public base URL of THIS add-on service (used to build button action URLs
  // that Google calls back). In prod this is the Cloud Run URL; in dev it's the
  // tunnel URL (ngrok/cloudflared) or http://localhost:4005 for local curl.
  ADDON_BASE_URL: z.string().default('http://localhost:4005'),

  // Local-dev convenience: pin a tenant/user so cards show real clone data
  // without a full Gmail-user -> tenant resolution (that lands in a later phase).
  ADDON_DEV_TENANT_ID: z.string().optional(),
  ADDON_DEV_USER_ID: z.string().optional(),

  // Verify Google's signed ID token on inbound requests. MUST be 'true' before
  // any public deployment; left 'false' for local curl testing. See auth/verify.ts.
  ADDON_VERIFY_ID_TOKEN: z.string().default('false'),

  // Expected audience of the inbound Authorization bearer token (this add-on's
  // public URL). When set, it's enforced; when blank, only Google's signature +
  // issuer are checked. Set to the Cloud Run URL in prod.
  ADDON_AUDIENCE: z.string().default(''),

  // The add-on's OAuth client id — the audience of event.userIdToken (which
  // carries the signed-in user's email). Reuses the CRM Google client by default.
  GOOGLE_CLIENT_ID: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid environment variables:');
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`);
      }
      process.exit(1);
    }
    _env = result.data;
  }
  return _env;
}
