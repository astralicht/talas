import mongoose, { type ClientSession } from 'mongoose';
import { getEnv } from '@/lib/env';

interface MongooseCache {
  connection: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalForMongoose = globalThis as unknown as { __talasMongoose?: MongooseCache };

const cache: MongooseCache =
  globalForMongoose.__talasMongoose ?? (globalForMongoose.__talasMongoose = { connection: null, promise: null });

mongoose.set('strictQuery', true);

export async function connectDb(uri?: string): Promise<typeof mongoose> {
  if (cache.connection) return cache.connection;
  if (!cache.promise) {
    const env = getEnv();
    cache.promise = mongoose.connect(uri ?? env.DATABASE_URL, {
      autoIndex: env.NODE_ENV !== 'production',
      maxPoolSize: env.NODE_ENV === 'test' ? 5 : 20,
      serverSelectionTimeoutMS: 10_000,
    });
  }
  try {
    cache.connection = await cache.promise;
    return cache.connection;
  } catch (error) {
    cache.promise = null;
    throw error;
  }
}

export async function disconnectDb(): Promise<void> {
  if (!cache.connection) {
    cache.promise = null;
    return;
  }
  await cache.connection.disconnect();
  cache.connection = null;
  cache.promise = null;
}

export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const connection = await connectDb();
  const session = await connection.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    if (result === undefined) {
      throw new Error('Transaction completed without producing a result');
    }
    return result;
  } finally {
    await session.endSession();
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Ensures the process has a usable database connection. Auth routes that run
 * without a session (login, register, password reset) must call this before
 * their first model operation — nothing else triggers a connect in a fresh
 * Next.js process.
 */
export function ensureDbConnection(): Promise<typeof mongoose> {
  return connectDb();
}

export async function resetDatabaseConnectionForTests(): Promise<void> {
  await disconnectDb();
}
