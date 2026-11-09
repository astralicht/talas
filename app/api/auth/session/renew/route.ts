import { NextResponse, type NextRequest } from 'next/server';
import { User } from '@/lib/db/models/user';
import { ensureDbConnection } from '@/lib/db/connection';
import { verifyRenewNonce } from '@/lib/auth/access-token';
import { signAccessToken } from '@/lib/auth/tokens';
import {
  RefreshTokenReuseError,
  revokeAllForUser,
  rotateRefreshToken,
} from '@/lib/auth/refresh';
import { issueAndStoreCsrfToken } from '@/lib/auth/csrf';
import {
  clearAuthCookiesOnResponse,
  readCookie,
  REFRESH_COOKIE,
  setAuthCookiesOnResponse,
} from '@/lib/auth/cookies';
import {
  auditEvents,
} from '@/lib/logging/audit-events';
import { getCorrelationId, runWithCorrelation, newCorrelationId } from '@/lib/logging/correlation';
import { clientIp } from '@/lib/http/responses';
import { securityHeaders } from '@/lib/http/security-headers';

export const dynamic = 'force-dynamic';

const AUTH_PREFIX = ['/login', '/register', '/forgot-password', '/reset-password'];

/**
 * The destination of a renewal hop. Printable ASCII only, a single path, and it
 * may never escape the app through `//` or embedded control characters.
 */
function safeDestination(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!/^\/(?!\/)[!-~]{0,199}$/.test(raw)) return '/dashboard';
  const clean = raw.replace(/["\\<>\r\n]/g, '');
  if (AUTH_PREFIX.some((prefix) => clean.startsWith(prefix))) return '/dashboard';
  return clean;
}

/** A same-origin browser navigation (fetch-metadata is enforced, fail-closed). */
function isSameOriginNavigation(request: NextRequest): boolean {
  const mode = request.headers.get('sec-fetch-mode');
  const site = request.headers.get('sec-fetch-site');
  return mode === 'navigate' && site === 'same-origin';
}

function redirectWithClearedAuth(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL('/login', request.nextUrl.origin));
  clearAuthCookiesOnResponse(response);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  for (const [key, headerValue] of Object.entries(securityHeaders())) {
    response.headers.set(key, headerValue);
  }
  return response;
}

function redirectBack(request: NextRequest, next: string): NextResponse {
  const response = NextResponse.redirect(new URL(next, request.nextUrl.origin));
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  for (const [key, headerValue] of Object.entries(securityHeaders())) {
    response.headers.set(key, headerValue);
  }
  return response;
}

/**
 * Silent session-renewal landing used by the middleware: rotates the refresh
 * token (hashed, transactional, reuse-detected — identical to POST
 * /api/auth/refresh), re-issues access/refresh/CSRF cookies, and sends the
 * browser back to the protected page it originally aimed for. Any failure
 * clears the auth cookies and lands on /login, so every path terminates —
 * no /login <-> /dashboard redirect loop is possible.
 */
export const GET = (request: NextRequest): Promise<NextResponse> =>
  runWithCorrelation(
    { correlationId: getCorrelationId() ?? newCorrelationId() },
    async () => {
      const next = safeDestination(request.nextUrl.searchParams.get('next'));
      const nonceParam = request.nextUrl.searchParams.get('nonce');

      // Fail-closed gate: only our middleware initiates this endpoint, and only
      // for a same-origin navigation carrying a fresh signed nonce.
      if (!nonceParam) return redirectWithClearedAuth(request);
      const nonce = await verifyRenewNonce(nonceParam);
      if (!nonce || nonce.next !== next) return redirectWithClearedAuth(request);
      if (!isSameOriginNavigation(request)) return redirectWithClearedAuth(request);

      await ensureDbConnection();

      const rawRefresh = await readCookie(REFRESH_COOKIE);
      if (!rawRefresh) return redirectWithClearedAuth(request);

      try {
        const rotated = await rotateRefreshToken(rawRefresh, {
          ip: clientIp(request),
          userAgent: request.headers.get('user-agent') ?? 'unknown',
        });

        const user = await User.findById(rotated.userId).exec();
        if (!user || user.status !== 'active') {
          await revokeAllForUser(rotated.userId);
          return redirectWithClearedAuth(request);
        }

        const accessToken = await signAccessToken({
          userId: user._id.toHexString(),
          email: user.email,
        });
        const csrfToken = await issueAndStoreCsrfToken();

        await auditEvents.tokenRefresh({
          userId: user._id.toHexString(),
          correlationId: getCorrelationId() ?? 'renew',
          ip: clientIp(request),
          userAgent: request.headers.get('user-agent') ?? 'unknown',
        });

        const response = redirectBack(request, next);
        setAuthCookiesOnResponse(response, {
          accessToken,
          refreshToken: rotated.token,
          csrfToken,
        });
        return response;
      } catch (error) {
        if (error instanceof RefreshTokenReuseError) {
          await auditEvents.refreshReuse({
            userId: null,
            correlationId: getCorrelationId() ?? 'renew',
            ip: clientIp(request),
            userAgent: request.headers.get('user-agent') ?? 'unknown',
            metadata: { tokenId: error.reusedTokenId },
          });
        }
        return redirectWithClearedAuth(request);
      }
    },
  );
