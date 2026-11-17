import { ensureRedisConnected } from '@/lib/db/redis';

/**
 * Daily lesson-generation allowance (constitution v2.3.0). One counter per user
 * per UTC day in a shared store so it holds across instances. A successful
 * generation consumes one point reserved at request admission; a terminal
 * failure refunds it, so failed attempts never consume the allowance.
 * Regeneration never reserves in the first place.
 *
 * Storage follows the rate-limiter convention: Redis everywhere except the
 * test environment, which uses an in-process store (fresh per test run, and
 * resettable through /api/test/reset-limits for the long-lived e2e server).
 */
const KEY_PREFIX = 'talas-plan-gen';

interface MemoryEntry {
  count: number;
  /** Epoch ms when this day's counter dies (UTC midnight). */
  expiresAt: number;
}

// Module state on globalThis: next dev compiles per-route bundles, so plain
// module variables would give every route its own counter map (and the test
// reset endpoint would clear a different copy than the routes use).
const globalForAllowance = globalThis as unknown as {
  __talasPlanAllowance?: Map<string, MemoryEntry>;
};
const memoryStore: Map<string, MemoryEntry> =
  (globalForAllowance.__talasPlanAllowance ??= new Map());

function usingRedis(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env.RATE_LIMIT_MEMORY !== 'true';
}

function utcDayKey(userId: string, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `${KEY_PREFIX}:${userId}:${day}`;
}

function secondsUntilUtcMidnight(date = new Date()): number {
  const nextMidnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((nextMidnight - date.getTime()) / 1000));
}

function nextUtcMidnight(date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  );
}

/**
 * Atomic reserve: increments only when the counter is below the limit, so
 * concurrent admissions cannot overshoot. Returns the post-reservation count,
 * or null when the allowance is exhausted.
 */
const RESERVE_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
if current >= limit then return -1 end
local next = redis.call('INCR', KEYS[1])
if next == 1 then redis.call('EXPIRE', KEYS[1], ttl) end
return next
`;

const REFUND_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > 0 then return redis.call('DECR', KEYS[1]) end
return 0
`;

export interface AllowanceReservation {
  reserved: boolean;
  /** Generation count for today after this reservation (or the cap when blocked). */
  used: number;
  limit: number;
  /** Next UTC midnight — when the counter resets. */
  resetsAt: Date;
}

export async function reserveLessonGeneration(
  userId: string,
  limit: number,
): Promise<AllowanceReservation> {
  const resetsAt = nextUtcMidnight();
  if (!usingRedis()) {
    const key = utcDayKey(userId);
    const entry = memoryStore.get(key);
    const current = entry && entry.expiresAt > Date.now() ? entry.count : 0;
    if (current >= limit) {
      return { reserved: false, used: current, limit, resetsAt };
    }
    memoryStore.set(key, { count: current + 1, expiresAt: resetsAt.getTime() });
    return { reserved: true, used: current + 1, limit, resetsAt };
  }

  const client = await ensureRedisConnected();
  const result = await client.eval(
    RESERVE_LUA,
    1,
    utcDayKey(userId),
    String(limit),
    String(secondsUntilUtcMidnight()),
  ) as unknown;
  const used = Number(result);
  if (used < 0) {
    const current = Number(await client.get(utcDayKey(userId))) || 0;
    return { reserved: false, used: current, limit, resetsAt };
  }
  return { reserved: true, used, limit, resetsAt };
}

/** Returns a reserved point after a terminal failure; never goes below zero. */
export async function refundLessonGeneration(userId: string): Promise<void> {
  if (!usingRedis()) {
    const key = utcDayKey(userId);
    const entry = memoryStore.get(key);
    if (entry && entry.count > 0) entry.count -= 1;
    return;
  }
  const client = await ensureRedisConnected();
  await client.eval(REFUND_LUA, 1, utcDayKey(userId)) as unknown;
}

export interface AllowanceUsage {
  used: number;
  /** Null when Redis is unreachable in the usage path — the UI shows the cap without the count. */
  resetsAt: Date | null;
}

export async function allowanceUsage(userId: string): Promise<AllowanceUsage> {
  if (!usingRedis()) {
    const key = utcDayKey(userId);
    const entry = memoryStore.get(key);
    const used = entry && entry.expiresAt > Date.now() ? entry.count : 0;
    return { used, resetsAt: nextUtcMidnight() };
  }
  try {
    const client = await ensureRedisConnected();
    const key = utcDayKey(userId);
    const [used, ttl] = await Promise.all([
      client.get(key),
      client.ttl(key),
    ]);
    const resetsAt =
      ttl > 0 ? new Date(Date.now() + ttl * 1000) : nextUtcMidnight();
    return { used: Number(used) || 0, resetsAt };
  } catch {
    return { used: 0, resetsAt: null };
  }
}

/** Clears the in-process allowance store (test environment only). */
export function resetAllowanceForTests(): void {
  memoryStore.clear();
}
