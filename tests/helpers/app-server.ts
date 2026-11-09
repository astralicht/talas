import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ensureIntegrationMongo } from './mongo';

const globalForTestApp = globalThis as unknown as {
  __talasTestAppServer?: Promise<{ url: string; close: () => Promise<void> }>;
};

const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3102',
  JOB_QUEUE_MEMORY: 'true',
  RATE_LIMIT_MEMORY: 'true',
  EMAIL_TRANSPORT: 'memory',
  S3_FAKE: 'true',
  S3_ACCESS_KEY_ID: 'integration-key',
  S3_SECRET_ACCESS_KEY: 'integration-secret-abcdefghijklmnop',
  CLAMAV_FAKE: 'clean',
  AI_FAKE_LESSON: 'true',
  AI_FAULT_INJECTION: 'false',
  AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'integration-fake-openai-key',
  LOG_LEVEL: 'info',
  JWT_ACCESS_SECRET: 'integration-access-secret-that-is-long-enough-123',
  JWT_REFRESH_SECRET: 'integration-refresh-secret-that-is-long-enough-123',
  CSRF_SECRET: 'integration-csrf-secret-that-is-long-enough-123456',
};

function repoFile(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

/**
 * Builds the Next application once (`next build`) when no build exists. The
 * build runs as a child process; test fakes are runtime env so they stay separate.
 */
async function ensureBuiltApp(): Promise<void> {
  if (existsSync(repoFile('.next', 'BUILD_ID'))) return;
  await new Promise<void>((resolve, reject) => {
    const build = spawn('node_modules/.bin/next', ['build'], {
      cwd: process.cwd(),
      env: { ...process.env, ...DEFAULTS, NODE_ENV: 'production' },
      stdio: 'inherit',
    });
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`next build exited with ${code}`))));
    build.on('error', reject);
  });
}

/**
 * Serves the built Next application in-process so route handlers, cookies, CSRF,
 * and middleware are exercised through real HTTP. External services are supplied
 * by the S3_FAKE / CLAMAV_FAKE / AI_FAKE_LESSON fake stack plus the memory email
 * sender and BullMQ memory queue. NODE_ENV stays 'test' in this process.
 */
export async function startTestApp(): Promise<string> {
  globalForTestApp.__talasTestAppServer ??= (async () => {
    // Route the memory server's data dirs away from the small root filesystem.
    process.env.TMPDIR ??= '/home/astralicht/.local/tmp';
    const mongoUri = await ensureIntegrationMongo();
    for (const [key, value] of Object.entries(DEFAULTS)) {
      (process.env as Record<string, string>)[key] = value;
    }
    (process.env as Record<string, string>).DATABASE_URL = mongoUri;

    const { resetEnvCache } = await import('@/lib/env');
    resetEnvCache();

    await ensureBuiltApp();

    const next = (await import('next')).default;
    const app = (await next({ dir: process.cwd() })) as unknown as {
      prepare: () => Promise<void>;
      getRequestHandler: () => (req: unknown, res: unknown) => Promise<void>;
      close: () => Promise<void>;
    };
    await app.prepare();

    // Warm the shared mongoose connection before serving; both the Vite and
    // Next module copies of `mongoose` share this singleton in one process.
    const { connectDb, isDatabaseConnected } = await import('@/lib/db/connection');
    await connectDb(mongoUri);

    const server = http.createServer((request, response) => {
      void app.getRequestHandler()(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 3102;
    const url = `http://127.0.0.1:${port}`;
    console.log('[test-app] ready at', url, 'db connected:', isDatabaseConnected());

    return {
      url,
      close: async () => {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
        await app.close().catch(() => undefined);
      },
    };
  })();

  return (await globalForTestApp.__talasTestAppServer).url;
}

export async function stopTestApp(): Promise<void> {
  const state = await globalForTestApp.__talasTestAppServer;
  globalForTestApp.__talasTestAppServer = undefined;
  await state?.close();
}
