import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(4001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),

  // Service URLs
  WEB_URL: z.string().default('http://localhost:4000'),
  SERVICE_API_URL: z.string().default('http://localhost:4001'),
  SERVICE_GMAIL_URL: z.string().min(1, 'SERVICE_GMAIL_URL is required'),
  SERVICE_ANALYSIS_URL: z.string().min(1, 'SERVICE_ANALYSIS_URL is required'),
  SERVICE_NOTIFICATIONS_URL: z.string().default('http://localhost:4004'),

  // Better Auth
  BETTER_AUTH_URL: z.string().default('http://localhost:4001'),
  BETTER_AUTH_SECRET: z.string().optional(),

  // Legacy session auth
  SESSION_SECRET: z.string().optional(),
  SESSION_DURATION_MS: z.coerce.number().default(1800000),

  // App URL (used in notification links)
  APP_URL: z.string().default('http://localhost:3000'),

  // Optional / dev-only
  TEST_TOKEN_API_KEY: z.string().optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  ALLOW_DEV_AUTH: z.string().optional(),
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
