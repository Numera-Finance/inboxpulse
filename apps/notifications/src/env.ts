import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(4004),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Service URLs
  WEB_URL: z.string().default('http://localhost:4000'),
  SERVICE_API_URL: z.string().default('http://localhost:4001'),

  // Auth
  SERVICE_API_KEY: z.string().min(1, 'SERVICE_API_KEY is required'),

  // Email (Amazon SES)
  AWS_SES_REGION: z.string().default('us-east-1'),
  AWS_SES_ACCESS_KEY_ID: z.string().optional(),
  AWS_SES_SECRET_ACCESS_KEY: z.string().optional(),
  FROM_EMAIL: z.string().default('hello@9mo.ai'),
  FROM_NAME: z.string().default('MSCFO Email Sentiment'),

  // Email override: comma-separated allowlist. All outbound emails are redirected
  // to these addresses. Set to empty string to disable and send to real recipients.
  EMAIL_OVERRIDE: z.string().default('mbalsara@mystartupcfo.com,vmohan@mystartupcfo.com'),
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
