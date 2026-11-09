import { MongoMemoryReplSet } from 'mongodb-memory-server';

const globalForTestMongo = globalThis as unknown as {
  __talasTestMongo?: Promise<MongoMemoryReplSet>;
};

/**
 * Shared in-memory MongoDB replica set for integration and contract tests.
 * Transactions (autosave conflicts, revision appends) need a replica set.
 * The startup timeout is raised because cold-cache machines can take longer.
 */
export async function ensureIntegrationMongo(): Promise<string> {
  globalForTestMongo.__talasTestMongo ??= MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    // Cold caches make mongod start slowly on this machine; give it a minute.
    instanceOpts: [{ launchTimeout: 60_000 }],
  });
  const replset = await globalForTestMongo.__talasTestMongo;
  return replset.getUri('talas-integration');
}

export async function stopIntegrationMongo(): Promise<void> {
  const replset = await globalForTestMongo.__talasTestMongo;
  globalForTestMongo.__talasTestMongo = undefined;
  await replset?.stop();
}
