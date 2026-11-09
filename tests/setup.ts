import { afterAll, beforeAll } from 'vitest';

// Keep mongod data dirs and temp files on the roomier filesystem: the memory
// server can write hundreds of megabytes per instance.
process.env.TMPDIR ??= '/home/astralicht/.local/tmp';

(process.env as Record<string, string | undefined>).NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-that-is-long-enough-1234';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-that-is-long-enough-123';
process.env.CSRF_SECRET = process.env.CSRF_SECRET ?? 'test-csrf-secret-that-is-long-enough-1234';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.EMAIL_TRANSPORT = process.env.EMAIL_TRANSPORT ?? 'memory';
process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? 'openai';
process.env.AI_FAULT_INJECTION = process.env.AI_FAULT_INJECTION ?? 'false';
process.env.AI_DAILY_BUDGET_USD = process.env.AI_DAILY_BUDGET_USD ?? '2.00';
process.env.CLAMAV_HOST = process.env.CLAMAV_HOST ?? '127.0.0.1';
process.env.CLAMAV_PORT = process.env.CLAMAV_PORT ?? '3310';
process.env.S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
process.env.S3_REGION = process.env.S3_REGION ?? 'us-east-1';
process.env.S3_BUCKET = process.env.S3_BUCKET ?? 'talas-test';
process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID ?? 'test';
process.env.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY ?? 'test-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'mongodb://127.0.0.1:27017/talas-test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let memoryServer: { stop: () => Promise<unknown> } | null = null;

beforeAll(async () => {
  if (process.env.USE_MEMORY_MONGO === 'true') {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    memoryServer = replSet;
    process.env.DATABASE_URL = replSet.getUri('talas-test');
  }
});

afterAll(async () => {
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
});
