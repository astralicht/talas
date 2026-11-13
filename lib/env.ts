import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1).default('mongodb://localhost:27017/talas?replicaSet=rs0'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

    S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1).default('talas-local'),
    S3_ACCESS_KEY_ID: z.string().min(1).default('talas'),
    S3_SECRET_ACCESS_KEY: z.string().min(1).default('talas-local-secret'),
    S3_FORCE_PATH_STYLE: booleanString.default(true),
    S3_FAKE: booleanString.default(false),

    CLAMAV_HOST: z.string().min(1).default('localhost'),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    CLAMAV_FAKE: z.enum(['', 'clean', 'infected', 'unavailable']).default(''),

    JWT_ACCESS_SECRET: z.string().min(32).default('development-access-secret-change-me-1234'),
    JWT_REFRESH_SECRET: z.string().min(32).default('development-refresh-secret-change-me-123'),
    CSRF_SECRET: z.string().min(32).default('development-csrf-secret-change-me-12345'),

    // Constitution v2.0.0: access tokens MUST expire within 24 hours and
    // refresh tokens within 30 days; both TTLs are env-configurable with
    // bounded validation and default to the constitutional maximums.
    SESSION_ACCESS_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(24 * 60 * 60)
      .default(24 * 60 * 60),
    SESSION_REFRESH_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(3_600)
      .max(30 * 24 * 60 * 60)
      .default(30 * 24 * 60 * 60),

    OPENAI_API_KEY: z.string().optional().default(''),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional().default(''),
    AI_PROVIDER: z.enum(['openai', 'google', 'opengo']).default('openai'),
    AI_DAILY_BUDGET_USD: z.coerce.number().positive().default(2),
    AI_MODEL_OPENAI: z.string().default('gpt-4o'),
    AI_MODEL_GOOGLE: z.string().default('gemini-2.0-flash'),
    OPENCODE_API_KEY: z.string().optional().default(''),
    AI_MODEL_OPENGO: z.string().default('glm-5.3'),
    AI_FAULT_INJECTION: booleanString.default(false),
    AI_FAKE_LESSON: booleanString.default(false),

    RESEND_API_KEY: z.string().optional().default(''),
    EMAIL_FROM: z.string().min(1).default('Talas <no-reply@talas.local>'),
    EMAIL_TRANSPORT: z.enum(['resend', 'mailhog', 'memory']).default('mailhog'),
    MAILHOG_SMTP_URL: z.string().default('smtp://localhost:1025'),

    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
    MAX_JOB_MS: z.coerce.number().int().positive().default(120_000),
    E2E_MODE: booleanString.default(false),
  })
  .superRefine((value, ctx) => {
    if (value.SESSION_REFRESH_TTL_SECONDS < value.SESSION_ACCESS_TTL_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_REFRESH_TTL_SECONDS'],
        message:
          'SESSION_REFRESH_TTL_SECONDS must be greater than or equal to SESSION_ACCESS_TTL_SECONDS',
      });
    }

    if (value.NODE_ENV !== 'production') return;

    const required = [
      ['JWT_ACCESS_SECRET', value.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', value.JWT_REFRESH_SECRET],
      ['CSRF_SECRET', value.CSRF_SECRET],
      ['S3_ACCESS_KEY_ID', value.S3_ACCESS_KEY_ID],
      ['S3_SECRET_ACCESS_KEY', value.S3_SECRET_ACCESS_KEY],
    ] as const;

    for (const [key, secret] of required) {
      if (secret.startsWith('development-') || secret === 'talas') {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be set in production` });
      }
    }

    if (value.AI_PROVIDER === 'openai' && !value.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when AI_PROVIDER is openai',
      });
    }
    if (value.AI_PROVIDER === 'google' && !value.GOOGLE_GENERATIVE_AI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_GENERATIVE_AI_API_KEY'],
        message: 'GOOGLE_GENERATIVE_AI_API_KEY is required when AI_PROVIDER is google',
      });
    }
    if (value.AI_PROVIDER === 'opengo' && !value.OPENCODE_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENCODE_API_KEY'],
        message: 'OPENCODE_API_KEY is required when AI_PROVIDER is opengo',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${summary}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

export function getEnv(): Env {
  return loadEnv();
}

export const env: Env = new Proxy({} as Env, {
  get(_target, property: string | symbol) {
    return getEnv()[property as keyof Env];
  },
});
