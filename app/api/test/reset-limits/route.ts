import { route } from '@/lib/http/handler';
import { json } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { resetRateLimitersForTests } from '@/lib/security/rate-limit';
import { resetAllowanceForTests } from '@/lib/plans/allowance';
import { ensureRedisConnected } from '@/lib/db/redis';

export const dynamic = 'force-dynamic';

const RESET_HEADER = 'x-talas-test-reset';

/**
 * Test-harness-only limiter reset. The e2e dev server is long-lived
 * (`reuseExistingServer`), so per-run rate-limit and plan-allowance state
 * would otherwise accumulate across Playwright runs. The endpoint answers 404
 * outside the e2e mode and requires the shared header, so it can never be
 * reached in normal development or production.
 */
export const POST = route({}, async ({ request }) => {
  const enabled =
    process.env.E2E_MODE === 'true' && process.env.NODE_ENV !== 'production';
  if (!enabled || request.headers.get(RESET_HEADER) !== '1') {
    throw errors.notFound();
  }

  resetRateLimitersForTests();
  resetAllowanceForTests();

  // next dev forces NODE_ENV=development, so the e2e server runs Redis-backed
  // limiters and a Redis-backed daily allowance: the in-memory clears above
  // are not enough — flush the shared-store keys too. In memory-only test
  // environments (vitest) there is no Redis and the clears suffice.
  try {
    const client = await ensureRedisConnected();
    for (const pattern of ['talas-rl:*', 'talas-plan-gen:*']) {
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) await client.del(...keys);
      } while (cursor !== '0');
    }
  } catch {
    // Redis unreachable: memory-only mode, nothing more to flush.
  }

  return json({ ok: true });
});
