import { RateLimiterMemory, RateLimiterRedis, type RateLimiterAbstract } from 'rate-limiter-flexible';
import { AppError } from '@/lib/http/errors';
import { ensureRedisConnected } from '@/lib/db/redis';

export interface RateLimitPolicy {
  points: number;
  durationSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
}

const AUTH_IP: RateLimitPolicy = { points: 10, durationSeconds: 15 * 60 };
const LOGIN_ACCOUNT: RateLimitPolicy = { points: 5, durationSeconds: 15 * 60 };
const UPLOAD_HOURLY: RateLimitPolicy = { points: 10, durationSeconds: 60 * 60 };
const UPLOAD_MINUTE: RateLimitPolicy = { points: 5, durationSeconds: 60 };
const GENERATE_HOURLY: RateLimitPolicy = { points: 10, durationSeconds: 60 * 60 };

export const RATE_LIMITS = {
  AUTH_IP,
  LOGIN_ACCOUNT,
  UPLOAD_HOURLY,
  UPLOAD_MINUTE,
  UPLOAD: [UPLOAD_MINUTE, UPLOAD_HOURLY] as const,
  GENERATE_HOURLY,
} as const;

type LimiterLike = Pick<RateLimiterAbstract, 'consume' | 'delete'>;

const memoryLimiters = new Map<string, RateLimiterMemory>();
const redisLimiters = new Map<string, RateLimiterRedis>();

function limiterKey(policy: RateLimitPolicy): string {
  return `${policy.points}:${policy.durationSeconds}`;
}

function redisEnabled(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env.RATE_LIMIT_MEMORY !== 'true';
}

/** Local-testing escape hatch: skip every rate limit when explicitly enabled. */
function rateLimitDisabled(): boolean {
  return process.env.RATE_LIMIT_DISABLED === 'true';
}

async function getLimiter(policy: RateLimitPolicy): Promise<LimiterLike> {
  const key = limiterKey(policy);
  if (!redisEnabled()) {
    let limiter = memoryLimiters.get(key);
    if (!limiter) {
      limiter = new RateLimiterMemory({
        points: policy.points,
        duration: policy.durationSeconds,
      });
      memoryLimiters.set(key, limiter);
    }
    return limiter;
  }

  if (!redisLimiters.has(key)) {
    const client = await ensureRedisConnected();
    const insurance = new RateLimiterMemory({
      points: policy.points,
      duration: policy.durationSeconds,
    });
    redisLimiters.set(
      key,
      new RateLimiterRedis({
        storeClient: client,
        points: policy.points,
        duration: policy.durationSeconds,
        insuranceLimiter: insurance,
        keyPrefix: 'talas-rl',
      }),
    );
  }
  const limiter = redisLimiters.get(key);
  if (!limiter) throw new Error('Rate limiter could not be created');
  return limiter;
}

export async function consumeRateLimit(
  key: string,
  policy: RateLimitPolicy,
  pointsToConsume = 1,
): Promise<RateLimitResult> {
  if (rateLimitDisabled()) {
    return {
      allowed: true,
      limit: policy.points,
      remaining: policy.points,
      resetSeconds: 0,
      retryAfterSeconds: 0,
    };
  }
  const limiter = await getLimiter(policy);
  try {
    const result = await limiter.consume(key, pointsToConsume);
    return {
      allowed: true,
      limit: policy.points,
      remaining: Math.max(0, result.remainingPoints),
      resetSeconds: Math.max(0, Math.ceil(result.msBeforeNext / 1000)),
      retryAfterSeconds: 0,
    };
  } catch (rejection) {
    if (rejection && typeof rejection === 'object' && 'msBeforeNext' in rejection) {
      const msBeforeNext = Number((rejection as { msBeforeNext: number }).msBeforeNext);
      const retryAfterSeconds = Math.max(1, Math.ceil(msBeforeNext / 1000));
      return {
        allowed: false,
        limit: policy.points,
        remaining: 0,
        resetSeconds: retryAfterSeconds,
        retryAfterSeconds,
      };
    }
    throw rejection;
  }
}

export async function consumeRateLimits(
  key: string,
  policies: readonly RateLimitPolicy[],
): Promise<RateLimitResult> {
  let mostRestrictiveFailure: RateLimitResult | null = null;
  let lastAllowed: RateLimitResult | null = null;

  for (const policy of policies) {
    const result = await consumeRateLimit(key, policy);
    if (!result.allowed) {
      if (
        !mostRestrictiveFailure ||
        result.retryAfterSeconds > mostRestrictiveFailure.retryAfterSeconds
      ) {
        mostRestrictiveFailure = result;
      }
    } else {
      lastAllowed = result;
    }
  }

  if (mostRestrictiveFailure) return mostRestrictiveFailure;
  return (
    lastAllowed ?? {
      allowed: true,
      limit: policies[0]?.points ?? 0,
      remaining: 0,
      resetSeconds: 0,
      retryAfterSeconds: 0,
    }
  );
}

export async function enforceRateLimit(
  key: string,
  policies: RateLimitPolicy | readonly RateLimitPolicy[],
): Promise<RateLimitResult> {
  const list = Array.isArray(policies) ? policies : [policies];
  const result = await consumeRateLimits(key, list);
  if (!result.allowed) {
    throw new AppError('rate_limited', 429, 'Too many requests. Try again later.', {
      retryAfter: result.retryAfterSeconds,
    });
  }
  return result;
}

export function applyRateLimitHeaders(headers: Headers, result: RateLimitResult): void {
  headers.set('X-RateLimit-Limit', String(result.limit));
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  headers.set('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + result.resetSeconds));
  if (!result.allowed) headers.set('Retry-After', String(result.retryAfterSeconds));
}

export function resetRateLimitersForTests(): void {
  memoryLimiters.clear();
  redisLimiters.clear();
}
