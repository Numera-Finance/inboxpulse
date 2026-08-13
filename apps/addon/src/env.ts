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
  /**
   * The model doing structured extraction. gemma3:12b locally.
   *
   * Measured on the deep read, three runs each, M5 Pro / 48GB. "when" is the
   * field the calendar reminder is built on, so losing it silently removes the
   * Remind button:
   *
   *   gemma3:12b     6.2-7.3s    commit 3/3   when 3/3
   *   gemma3:27b    20.3-29.7s   commit 3/3   when 0/3
   *   qwen2.5:32b   23.5-31.8s   commit 3/3   when 3/3
   *
   * Bigger is not better here. gemma3:27b is 3x slower AND drops "when" every
   * time; qwen2.5:32b matches 12b's quality at 3.5x the wait. Do not re-litigate
   * this by intuition -- the 12b is the right choice on this hardware, and it is
   * the fastest option that gets every field right.
   *
   * Llama 4 does not fit: Scout is 67.4GB against 48GB of RAM (~36GB addressable
   * by the GPU), and Maverick is 244.8GB. Its MoE shape (17B active) is exactly
   * what this workload wants, so it is worth revisiting on a larger machine.
   */
  LIVE_ANALYSIS_MODEL: z.string().default('gpt-4o-mini'),
  /**
   * A faster model for jobs that are pure prose and need no structure.
   *
   * Measured on this machine, generation rate is the whole story:
   *   gemma3:12b                       31.9 tok/s
   *   nemotron-3.5-lightning:30b-mlx   81.3 tok/s
   *
   * But faster is not better everywhere. On the same thread, three runs each,
   * nemotron found the commitment 1/0/1 times against gemma3's 3/3, never
   * populated the `when` field at all -- which is what the calendar reminder is
   * built on, so "Remind me" simply disappears -- and missed the open question
   * every time. It is 3x quicker at losing the fields the card is
   * differentiated by.
   *
   * So the split is by JOB, not by preference: structured extraction stays on
   * the accurate model, and writing a reply -- where there is no schema to get
   * wrong and the only measure is whether the prose is good -- goes here.
   * Blank falls back to LIVE_ANALYSIS_MODEL.
   *
   * Turning nemotron's reasoning ON does not recover the lost fields, it just
   * fails: three runs of the deep read all ran past 120s and aborted, returning
   * nothing at all. A reasoning model handed six structured instructions spends
   * its budget reasoning about the schema. See LIVE_ANALYSIS_THINK.
   */
  LIVE_ANALYSIS_FAST_MODEL: z.string().default(''),
  LIVE_ANALYSIS_KEY: z.string().default(''),
  /**
   * Hard ceiling on the in-request LLM call; the card renders without it on
   * timeout.
   *
   * 20s, not 8s. The deep read measures 8.4-8.8s against gemma3:12b with history
   * and reply options, and a 12s ceiling aborted it outright on a long thread —
   * which costs the user the entire reading, not a slower one. The first paint
   * is 0.26s and this only runs behind an explicit "Read this thread", so the
   * user is already waiting deliberately; failing them at 12s to save 8s of
   * patience is the wrong trade.
   */
  LIVE_ANALYSIS_TIMEOUT_MS: z.coerce.number().default(20000),

  // 'ollama' uses the NATIVE /api/chat endpoint, which is the only way to turn a
  // reasoning model's thinking off. Ollama's OpenAI-compatible route silently
  // ignores the flag and reasons anyway — measured on
  // nemotron-3.5-lightning:30b-mlx, that is the difference between 0.84s and
  // 6.4s in the card render path. 'openai' is the portable default for LiteLLM
  // or any hosted provider.
  LIVE_ANALYSIS_PROVIDER: z.enum(['openai', 'ollama']).default('openai'),
  /**
   * Only honoured when provider is 'ollama'. Off by default: 7.6x faster on a
   * reasoning model, and Ollama REJECTS the field outright for models that
   * cannot think ("gemma3:12b does not support thinking", HTTP 400).
   *
   * Parsed as a string compared to 'true', NOT z.coerce.boolean(). Coercion
   * would make this permanently true: Boolean('false') === true, so every
   * non-empty value — including the literal string "false" — coerces to true.
   * This is why the rest of this file uses the string-compare pattern.
   */
  LIVE_ANALYSIS_THINK: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  // Google Chat incoming webhook for "Share to Chat". A webhook needs NO Google
  // OAuth scope on the add-on — it is a plain HTTPS POST — which is why this is
  // buildable today while draft-reply is not. Blank disables the button.
  CHAT_WEBHOOK_URL: z.string().default(''),
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
