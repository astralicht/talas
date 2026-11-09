import Redis from 'ioredis';
import { getEnv } from '@/lib/env';

const globalForRedis = globalThis as unknown as { __talasRedis?: Redis };

export function getRedis(): Redis {
  if (!globalForRedis.__talasRedis) {
    globalForRedis.__talasRedis = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });
  }
  return globalForRedis.__talasRedis;
}

export async function ensureRedisConnected(): Promise<Redis> {
  const client = getRedis();
  if (client.status === 'wait') await client.connect();
  return client;
}

export async function closeRedis(): Promise<void> {
  if (globalForRedis.__talasRedis) {
    await globalForRedis.__talasRedis.quit().catch(() => undefined);
    delete globalForRedis.__talasRedis;
  }
}

export async function resetRedisForTests(): Promise<void> {
  await closeRedis();
}
