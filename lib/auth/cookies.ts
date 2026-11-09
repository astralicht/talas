import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';

export const ACCESS_COOKIE_MAX_AGE = 900;
export const REFRESH_COOKIE_MAX_AGE = 604_800;
export const CSRF_COOKIE_MAX_AGE = 604_800;

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: string;
  maxAge: number;
}

function baseOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

export async function readCookie(name: string): Promise<string | undefined> {
  const store = await cookies();
  return store.get(name)?.value;
}

export async function setAccessCookie(token: string, maxAge = 900): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, token, baseOptions(maxAge));
}

export async function setRefreshCookie(token: string, maxAge = 604_800): Promise<void> {
  const store = await cookies();
  store.set(REFRESH_COOKIE, token, baseOptions(maxAge));
}

export async function setCsrfCookie(token: string, maxAge = 604_800): Promise<void> {
  const store = await cookies();
  store.set(CSRF_COOKIE, token, baseOptions(maxAge));
}

export async function setAuthCookies(tokens: {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}): Promise<void> {
  await setAccessCookie(tokens.accessToken);
  await setRefreshCookie(tokens.refreshToken);
  await setCsrfCookie(tokens.csrfToken);
}

export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
    store.set(name, '', { ...baseOptions(0), maxAge: 0, expires: new Date(0) });
  }
}

export function cookieOptions(maxAge: number): CookieOptions {
  return baseOptions(maxAge);
}

/** Attaches fresh auth cookies directly to an outgoing redirect/response object. */
export function setAuthCookiesOnResponse(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string },
): void {
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, baseOptions(ACCESS_COOKIE_MAX_AGE));
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, baseOptions(REFRESH_COOKIE_MAX_AGE));
  response.cookies.set(CSRF_COOKIE, tokens.csrfToken, baseOptions(CSRF_COOKIE_MAX_AGE));
}

/** Clears auth cookies on an outgoing response that cannot use the server `cookies()` API. */
export function clearAuthCookiesOnResponse(response: NextResponse): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
    response.cookies.set(name, '', { ...baseOptions(0), maxAge: 0, expires: new Date(0) });
  }
}
