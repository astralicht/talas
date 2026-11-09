import { NextResponse, type NextRequest } from 'next/server';
import { signRenewNonce, verifyAccessToken } from '@/lib/auth/access-token';
import { securityHeaders } from '@/lib/http/security-headers';

const PROTECTED_PREFIXES = ['/dashboard', '/materials', '/lessons', '/settings'];
const AUTH_PREFIXES = ['/login', '/register', '/forgot-password', '/reset-password'];
const RENEW_PATH = '/api/auth/session/renew';

function nonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Edge-safe correlation id (no Node-only imports leak into the middleware bundle). */
function newCorrelationId(): string {
  return crypto.randomUUID();
}

function contentSecurityPolicy(value: string): string {
  const development = process.env.NODE_ENV !== 'production';
  const scriptExtra = development ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${value}' 'strict-dynamic'${scriptExtra}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  const allowed = (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Correlation-Id',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function redirect(request: NextRequest, path: string, search: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = search;
  const response = NextResponse.redirect(url);
  for (const [key, headerValue] of Object.entries(securityHeaders())) {
    response.headers.set(key, headerValue);
  }
  return response;
}

interface SessionState {
  /** Access token cookie present (valid or not); the browser keeps it until maxAge. */
  hasAccessCookie: boolean;
  /** Access token verified for signature, issuer, audience, and expiry. */
  accessValid: boolean;
  hasRefreshCookie: boolean;
}

async function sessionState(request: NextRequest): Promise<SessionState> {
  const access = request.cookies.get('access_token')?.value;
  const refresh = request.cookies.get('refresh_token')?.value;
  const state: SessionState = {
    hasAccessCookie: Boolean(access),
    accessValid: false,
    hasRefreshCookie: Boolean(refresh),
  };
  if (access) {
    try {
      await verifyAccessToken(access);
      state.accessValid = true;
    } catch {
      // Signed by a previous deployment, expired, or tampered — treat as
      // anonymous; the refresh cookie (if any) may still be rotatable.
    }
  }
  return state;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    const preflight = new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
    for (const [key, headerValue] of Object.entries(securityHeaders())) {
      preflight.headers.set(key, headerValue);
    }
    return preflight;
  }

  const state = await sessionState(request);
  // "Signed in" for routing decisions means a genuinely valid access token —
  // not mere cookie presence. A stale access token must never bounce a user
  // off /login; that choice created the /login <-> /dashboard redirect loop.
  const hasSession = state.accessValid || state.hasRefreshCookie;
  const protectedPath = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (state.accessValid && AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return redirect(request, '/dashboard', '');
  }

  if (protectedPath) {
    if (!state.accessValid && state.hasRefreshCookie && request.method === 'GET') {
      // Silent renewal for a full navigation whose access token has expired but
      // whose refresh cookie may still rotate. RSC/prefetch and API requests
      // pass through and fall back to the login redirect on rejection, so every
      // path terminates even if the renewal endpoint is unreachable.
      const navigation = request.headers.get('sec-fetch-mode') === 'navigate';
      if (navigation) {
        const next = `${pathname}${request.nextUrl.search}`;
        const nonceToken = await signRenewNonce({ next });
        return redirect(
          request,
          RENEW_PATH,
          `?next=${encodeURIComponent(next)}&nonce=${encodeURIComponent(nonceToken)}`,
        );
      }
    } else if (!hasSession) {
      return redirect(request, '/login', `?next=${encodeURIComponent(pathname)}`);
    }
  }

  const response = NextResponse.next();
  const value = nonce();
  response.headers.set('Content-Security-Policy', contentSecurityPolicy(value));
  response.headers.set('x-nonce', value);
  response.headers.set('x-correlation-id', newCorrelationId());
  for (const [key, headerValue] of Object.entries(securityHeaders())) {
    response.headers.set(key, headerValue);
  }
  for (const [key, headerValue] of Object.entries(corsHeaders(origin))) {
    response.headers.set(key, headerValue);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
