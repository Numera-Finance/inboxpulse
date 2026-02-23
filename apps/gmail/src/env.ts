import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(4002),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  // Service URLs
  SERVICE_API_URL: z.string().min(1, 'SERVICE_API_URL is required'),

  // Auth
  SERVICE_API_KEY: z.string().min(1, 'SERVICE_API_KEY is required'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),

  // Gmail Pub/Sub
  GMAIL_PUBSUB_TOPIC: z.string().min(1, 'GMAIL_PUBSUB_TOPIC is required'),
  PUBSUB_VERIFICATION_TOKEN: z.string().optional(),
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
