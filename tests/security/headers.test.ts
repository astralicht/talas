import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse, type NextResponse as Response } from 'next/server';
import { middleware } from '../../middleware';
import { signAccessToken } from '@/lib/auth/tokens';

const USER_ID = '507f1f77bcf86cd799439011';

function requestFor(path: string, options: { cookie?: string; method?: string; mode?: string; site?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.mode) headers['sec-fetch-mode'] = options.mode;
  if (options.site) headers['sec-fetch-site'] = options.site;
  const request = new NextRequest(`http://localhost:3000${path}`, {
    method: options.method ?? 'GET',
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });
  return request;
}

async function middlewareOf(request: NextRequest): Promise<Response> {
  return middleware(request);
}

async function accessCookie(): Promise<string> {
  const token = await signAccessToken({ userId: USER_ID, email: 'user@example.com' });
  return `access_token=${token}`;
}

describe('security headers middleware', () => {
  it('sends HSTS-equivalent hardening headers on every response', async () => {
    const response = await middlewareOf(requestFor('/login'));
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets a nonce-based content security policy', async () => {
    const response = await middlewareOf(requestFor('/login'));
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('omits unsafe-eval outside development', async () => {
    const previous = (process.env as Record<string, string | undefined>).NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    try {
      const response = await middlewareOf(requestFor('/login'));
      const csp = response.headers.get('Content-Security-Policy') ?? '';
      expect(csp).not.toContain('unsafe-eval');
      expect(csp).toContain('upgrade-insecure-requests');
      expect(response.headers.get('Strict-Transport-Security')).toContain('includeSubDomains');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = previous;
    }
  });

  it('mints a fresh nonce per request and exposes it to the app', async () => {
    const first = await middlewareOf(requestFor('/login'));
    const second = await middlewareOf(requestFor('/login'));
    const nonceA = first.headers.get('x-nonce');
    const nonceB = second.headers.get('x-nonce');
    expect(nonceA).toMatch(/^[0-9a-f]{32}$/);
    expect(nonceB).toMatch(/^[0-9a-f]{32}$/);
    expect(nonceA).not.toBe(nonceB);
    expect(first.headers.get('Content-Security-Policy')).toContain(`nonce-${nonceA}`);
  });

  it('propagates a correlation id on every response', async () => {
    const response = await middlewareOf(requestFor('/login'));
    const correlationId = response.headers.get('x-correlation-id') ?? '';
    expect(typeof correlationId).toBe('string');
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('carries the hard security headers on redirects and preflights too', async () => {
    for (const path of ['/materials', '/lessons', '/settings', '/dashboard']) {
      const redirect = await middlewareOf(requestFor(path));
      expect(redirect.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(redirect.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(redirect.headers.get('Permissions-Policy')).toContain('camera=()');
      expect(redirect.headers.get('Strict-Transport-Security')).toContain('max-age=15552000');
    }

    const preflight = await middlewareOf(
      new NextRequest('http://localhost:3000/api/lessons', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:3000' },
      }),
    );
    expect(preflight.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('route protection middleware', () => {
  it('redirects unauthenticated users from protected prefixes to /login with a next parameter', async () => {
    const response = await middlewareOf(requestFor('/materials'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toMatch(/^http:\/\/localhost:3000\/login\?next=/);
  });

  it('routes signed-in users with a valid access token to the dashboard from auth pages', async () => {
    const cookie = await accessCookie();
    const request = requestFor('/login', { cookie });
    const response = await middlewareOf(request);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });

  it('does not bounce users with a stale access token off /login (the redirect loop regression)', async () => {
    const cookie = 'access_token=g-signature-from-a-previous-deployment';
    const response = await middlewareOf(requestFor('/login', { cookie }));
    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
  });

  it('does not bounce users with only a refresh token off /login', async () => {
    const cookie = 'refresh_token=opaque-rotating-token';
    const response = await middlewareOf(requestFor('/login', { cookie }));
    expect(response.headers.get('location')).toBeNull();
  });

  it('sends expired-access-plus-refresh navigations to the silent renewal hop', async () => {
    const cookie = 'refresh_token=opaque-rotating-token';
    const response = await middlewareOf(requestFor('/dashboard', { cookie, mode: 'navigate', site: 'same-origin' }));
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toMatch(/^http:\/\/localhost:3000\/api\/auth\/session\/renew/);
    expect(location).toMatch(/next=%2Fdashboard/);
    expect(location).toMatch(/nonce=/);
  });

  it('leaves non-navigation requests (RSC/prefetch) to pass through for the login fallback', async () => {
    const cookie = 'refresh_token=opaque-rotating-token';
    const response = await middlewareOf(requestFor('/dashboard', { cookie, mode: 'cors', site: 'same-origin' }));
    expect(response.status).not.toBe(307);
  });

  it('allows CORS-preflight requests through with the allowlist', async () => {
    const request = new NextRequest('http://localhost:3000/api/lessons', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:3000' },
    });
    const response = await middlewareOf(request);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('denies unknown origins CORS credentials silently (empty allowlist headers)', async () => {
    const request = new NextRequest('http://localhost:3000/api/lessons', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    const response = await middlewareOf(request);
    expect(response.status).toBe(204);
    void NextResponse;
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
