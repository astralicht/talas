import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { registerVerifiedUser, type RegisteredUser } from '../helpers/client';
import { signRenewNonce } from '@/lib/auth/access-token';
import { accessTokenTtlSeconds, verifyAccessToken } from '@/lib/auth/tokens';
import { connectDb } from '@/lib/db/connection';
import { RefreshToken } from '@/lib/db/models/refresh-token';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  // The contract worker's mongoose copy shares the app's database for direct
  // assertions (e.g. refresh-token family state).
  await connectDb(process.env.DATABASE_URL);
});

afterAll(async () => {
  await stopTestApp();
});

type CookieJar = Record<string, string>;

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function absorbCookies(jar: CookieJar, headers: Record<string, unknown>): void {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const line of list) {
    const [pair] = line.split(';');
    const [name, ...valueParts] = pair.split('=');
    if (!name) continue;
    jar[name.trim()] = valueParts.join('=').trim();
  }
}

/** Names of auth cookies that the response explicitly expired (fail-closed). */
function clearedCookieNames(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list
    .filter((line) => /Max-Age=0/i.test(line) || /Expires=Thu, 01 Jan 1970/i.test(line))
    .map((line) => line.split('=')[0]?.trim() ?? '');
}

/**
 * Normalizes a Location header to a request path. The in-process harness
 * serves middleware redirects as relative URLs and route redirects against
 * Next's fallback origin, so assertions must not depend on either.
 */
function pathOf(location: string): string {
  const url = location.startsWith('/')
    ? new URL(location, 'http://test.local')
    : new URL(location);
  return `${url.pathname}${url.search}`;
}

/** Raw GET through the real middleware, without automatic redirect following. */
function rawGet(
  path: string,
  jar: CookieJar,
  fetch: { mode?: string; site?: string } = {},
): request.Test {
  const test = request(appUrl).get(path);
  test.set('Cookie', cookieHeader(jar));
  if (fetch.mode) test.set('Sec-Fetch-Mode', fetch.mode);
  if (fetch.site) test.set('Sec-Fetch-Site', fetch.site);
  test.redirects(0);
  return test;
}

/**
 * A well-formed but expired access token — the exact state a returning
 * browser has after the configured access TTL passes while the refresh
 * cookie is still live.
 */
async function expiredAccessToken(userId: string, email: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET as string);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email, type: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer('talas')
    .setAudience('talas-web')
    .setIssuedAt(now - 2 * 60 * 60)
    .setExpirationTime(now - 60 * 60)
    .sign(secret);
}

async function renewalJarFor(owner: RegisteredUser): Promise<CookieJar> {
  return {
    access_token: await expiredAccessToken(owner.user.id, owner.user.email),
    refresh_token: owner.session.cookie('refresh_token') as string,
    csrf_token: owner.session.cookie('csrf_token') as string,
  };
}

describe('silent session renewal (specs/003 T007)', () => {
  it('renews a signed-in owner in one hop with fresh cookies', async () => {
    const owner = await registerVerifiedUser(appUrl);
    const originalRefresh = owner.session.cookie('refresh_token') as string;
    const jar = await renewalJarFor(owner);

    const first = await rawGet('/dashboard', jar, { mode: 'navigate', site: 'same-origin' });
    expect(first.status).toBe(307);
    const location = first.headers.location as string;
    expect(location).toContain('/api/auth/session/renew?');
    expect(location).toContain('next=%2Fdashboard');
    expect(location).toContain('nonce=');

    const hop = await rawGet(pathOf(location), jar, { mode: 'navigate', site: 'same-origin' });
    expect(hop.status).toBe(307);
    expect(pathOf(hop.headers.location as string)).toBe('/dashboard');

    const renewedJar: CookieJar = { ...jar };
    absorbCookies(renewedJar, hop.headers as Record<string, unknown>);
    expect(renewedJar.refresh_token).toBeTruthy();
    expect(renewedJar.refresh_token).not.toBe(originalRefresh);
    expect(renewedJar.csrf_token).toBeTruthy();
    const claims = await verifyAccessToken(renewedJar.access_token as string);
    expect(claims.userId).toBe(owner.user.id);
    expect(claims.expiresAt - claims.issuedAt).toBe(accessTokenTtlSeconds());

    const me = await rawGet('/api/me', renewedJar);
    expect(me.status).toBe(200);
    expect((me.body as { id?: string }).id).toBe(owner.user.id);
  });

  it('terminates the renewal navigation within the redirect cap on a rendered page', async () => {
    const owner = await registerVerifiedUser(appUrl);
    const jar = await renewalJarFor(owner);

    let path = '/dashboard';
    let hops = 0;
    let response!: request.Response;
    for (;;) {
      response = await rawGet(path, jar, { mode: 'navigate', site: 'same-origin' });
      absorbCookies(jar, response.headers as Record<string, unknown>);
      const location = response.headers.location as string | undefined;
      if (!location) break;
      hops += 1;
      // Bounded by design: middleware hop + renewal redirect back. Anything
      // more would be the /login <-> /dashboard redirect-loop regression.
      expect(hops).toBeLessThanOrEqual(2);
      path = pathOf(location);
    }

    expect(hops).toBe(2);
    expect(response.status).toBe(200);
    expect(String(response.headers['content-type'])).toContain('text/html');
  });

  it('fails closed when the nonce is missing', async () => {
    const owner = await registerVerifiedUser(appUrl);
    const jar = await renewalJarFor(owner);

    const response = await rawGet('/api/auth/session/renew?next=%2Fdashboard', jar, {
      mode: 'navigate',
      site: 'same-origin',
    });
    expect(response.status).toBe(307);
    expect(pathOf(response.headers.location as string)).toBe('/login');
    expect(clearedCookieNames(response.headers as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['access_token', 'refresh_token', 'csrf_token']),
    );
  });

  it('fails closed when the nonce is tampered', async () => {
    const owner = await registerVerifiedUser(appUrl);
    const jar = await renewalJarFor(owner);

    const response = await rawGet(
      '/api/auth/session/renew?next=%2Fdashboard&nonce=tampered-nonce-value',
      jar,
      { mode: 'navigate', site: 'same-origin' },
    );
    expect(response.status).toBe(307);
    expect(pathOf(response.headers.location as string)).toBe('/login');
    expect(clearedCookieNames(response.headers as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['access_token', 'refresh_token', 'csrf_token']),
    );
  });

  it('fails closed when the nonce is bound to a different destination', async () => {
    const owner = await registerVerifiedUser(appUrl);
    const jar = await renewalJarFor(owner);

    const nonce = await signRenewNonce({ next: '/dashboard' });
    const response = await rawGet(
      `/api/auth/session/renew?next=%2Fmaterials&nonce=${encodeURIComponent(nonce)}`,
      jar,
      { mode: 'navigate', site: 'same-origin' },
    );
    expect(response.status).toBe(307);
    expect(pathOf(response.headers.location as string)).toBe('/login');
    expect(clearedCookieNames(response.headers as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['access_token', 'refresh_token', 'csrf_token']),
    );
  });

  it('rejects cross-site navigations (fetch-metadata, fail-closed)', async () => {
    const owner = await registerVerifiedUser(appUrl);
    const jar = await renewalJarFor(owner);

    const nonce = await signRenewNonce({ next: '/dashboard' });
    const response = await rawGet(
      `/api/auth/session/renew?next=%2Fdashboard&nonce=${encodeURIComponent(nonce)}`,
      jar,
      { mode: 'navigate', site: 'cross-site' },
    );
    expect(response.status).toBe(307);
    expect(pathOf(response.headers.location as string)).toBe('/login');
    expect(clearedCookieNames(response.headers as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['access_token', 'refresh_token', 'csrf_token']),
    );
  });

  it('revokes the whole refresh-token family on reuse and clears the session', async () => {
    const owner = await registerVerifiedUser(appUrl);
    const stolen = owner.session.cookie('refresh_token') as string;

    // A legitimate rotation by the real client revokes the presented token...
    const rotate = await owner.session.post('/api/auth/refresh');
    expect(rotate.status).toBe(200);

    // ...so replaying the stolen copy is reuse detection: fail closed to a
    // cleared-cookie landing on /login.
    const nonce = await signRenewNonce({ next: '/dashboard' });
    const jar: CookieJar = {
      refresh_token: stolen,
      csrf_token: (owner.session.cookie('csrf_token') as string) ?? '',
    };
    const hop = await rawGet(
      `/api/auth/session/renew?next=%2Fdashboard&nonce=${encodeURIComponent(nonce)}`,
      jar,
      { mode: 'navigate', site: 'same-origin' },
    );
    expect(hop.status).toBe(307);
    expect(pathOf(hop.headers.location as string)).toBe('/login');
    expect(clearedCookieNames(hop.headers as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['access_token', 'refresh_token', 'csrf_token']),
    );

    // The family revocation must survive the aborted rotation transaction:
    // every refresh token of this user, including the fresh one issued to the
    // legitimate client, is revoked.
    const active = await RefreshToken.countDocuments({
      userId: owner.user.id,
      revokedAt: null,
    }).exec();
    expect(active).toBe(0);
  });
});
