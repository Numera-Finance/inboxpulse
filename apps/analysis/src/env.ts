import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(4003),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Service URLs
  SERVICE_API_URL: z.string().min(1, 'SERVICE_API_URL is required'),

  // Langfuse observability (optional - only needed if observability is enabled)
  LANGFUSE_ENABLED: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().default('https://cloud.langfuse.com'),

  // HuggingFace (optional - used for free email classification stages)
  HUGGINGFACE_API_TOKEN: z.string().optional(),

  // Show the sentiment classifier already-judged emails from the same mailbox
  // rather than relying only on the written instructions. Off unless explicitly
  // 'true', so the code ships dead and turning it back off is an env change on a
  // running service, not a rollback deploy.
  SENTIMENT_EXAMPLES_ENABLED: z.string().optional(),
  SENTIMENT_EXAMPLES_COUNT: z.coerce.number().default(10),
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
