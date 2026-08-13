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
  // carries the signed-in user's email).
  //
  // This must be the client the MARKETPLACE SDK created for the add-on
  // ("Google Workspace Add-ons", visible under Marketplace SDK > Credentials >
  // Authorization Resource), NOT crm-oauth. Google mints event.userIdToken for
  // the add-on's own client, so verifying against the CRM client checks the
  // wrong audience. The earlier "reuses the CRM Google client" default predates
  // the dedicated client existing.
  GOOGLE_CLIENT_ID: z.string().default(''),

  // ---------------------------------------------------------------------------
  // Live analysis (demo / dogfooding path)
  //
  // When set, a thread that InboxPulse has NOT ingested is analysed in-request
  // against an OpenAI-compatible endpoint and the result is rendered and thrown
  // away. Nothing is written to the database and nothing enters the shared
  // tenant. This exists so an inbox that is deliberately excluded from ingestion
  // -- any internal/leadership mailbox -- can still show a real panel.
  //
  // Blank (the default) disables it entirely, so production behaviour is
  // unchanged unless someone opts in.
  //
  // NOTE: if the endpoint is on a private network (e.g. a Tailscale address),
  // this add-on must run on a host that can reach it. Cloud Run cannot.
  // ---------------------------------------------------------------------------
  LIVE_ANALYSIS_URL: z.string().default(''),
  LIVE_ANALYSIS_MODEL: z.string().default('gpt-4o-mini'),
  LIVE_ANALYSIS_KEY: z.string().default(''),
  /** Hard ceiling on the in-request LLM call; the card renders without it on timeout. */
  LIVE_ANALYSIS_TIMEOUT_MS: z.coerce.number().default(8000),

  // 'ollama' uses the NATIVE /api/chat endpoint, which is the only way to turn a
  // reasoning model's thinking off. Ollama's OpenAI-compatible route silently
  // ignores the flag and reasons anyway — measured on
  // nemotron-3.5-lightning:30b-mlx, that is the difference between 0.84s and
  // 6.4s in the card render path. 'openai' is the portable default for LiteLLM
  // or any hosted provider.
  LIVE_ANALYSIS_PROVIDER: z.enum(['openai', 'ollama']).default('openai'),
  /** Only honoured when provider is 'ollama'. Off by default: 7.6x faster here. */
  LIVE_ANALYSIS_THINK: z.coerce.boolean().default(false),
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
