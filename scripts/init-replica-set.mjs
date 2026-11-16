#!/usr/bin/env node
/**
 * Idempotent replica-set bootstrap for the local dev stack (rs0).
 *
 * Shared by scripts/dev-stack.sh (Linux) and scripts/dev-stack.ps1 (Windows).
 * It uses the project's mongoose driver, so no mongosh is required — the
 * MongoDB Windows zip ships without the shell.
 *
 * Usage:
 *   MONGO_URI=mongodb://127.0.0.1:27098 MONGO_HOST=127.0.0.1:27098 \
 *     node scripts/init-replica-set.mjs
 *
 * Exits 0 once the set has a writable primary, 1 otherwise.
 */
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017';
const MONGO_HOST = process.env.MONGO_HOST ?? '127.0.0.1:27017';
const MAX_ATTEMPTS = 30;

const directUri = `${MONGO_URI}${MONGO_URI.includes('?') ? '&' : '?'}directConnection=true`;

let conn;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  try {
    conn = await mongoose.createConnection(directUri).asPromise();
    break;
  } catch (error) {
    if (attempt === MAX_ATTEMPTS) {
      console.error(
        `[init-replica-set] could not connect to ${MONGO_URI}: ${String(error?.message ?? error)}`,
      );
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

try {
  await conn.db.admin().command({
    replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: MONGO_HOST }] },
  });
  console.log('replSetInitiate sent');
} catch (error) {
  if (!/already initialized/i.test(String(error?.message ?? error))) {
    console.error(`[init-replica-set] replSetInitiate failed: ${String(error?.message ?? error)}`);
    await conn.close();
    process.exit(1);
  }
}

let primary = false;
for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
  try {
    const hello = await conn.db.admin().command({ hello: 1 });
    if (hello.isWritablePrimary) {
      primary = true;
      break;
    }
  } catch {
    // Elections and startup can make admin commands fail transiently; keep polling.
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

await conn.close();
if (!primary) {
  console.error('[init-replica-set] replica set rs0 did not elect a primary in time');
  process.exit(1);
}
console.log('replica set rs0 has a primary');
