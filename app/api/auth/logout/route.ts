import { route } from '@/lib/http/handler';
import { noContent } from '@/lib/http/responses';
import { revokeRefreshToken } from '@/lib/auth/refresh';
import { clearAuthCookies, readCookie, REFRESH_COOKIE } from '@/lib/auth/cookies';
import { auditEvents } from '@/lib/logging/audit-events';
import { ensureDbConnection } from '@/lib/db/connection';

export const dynamic = 'force-dynamic';

export const POST = route({ csrf: true }, async ({ ip, userAgent, correlationId }) => {
  const rawRefresh = await readCookie(REFRESH_COOKIE);
  await ensureDbConnection();
  if (rawRefresh) {
    await revokeRefreshToken(rawRefresh);
    await auditEvents.signOut({ correlationId, ip, userAgent });
  }
  await clearAuthCookies();
  return noContent();
});
