import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { readCookie, setCsrfCookie, CSRF_COOKIE } from './cookies';

function signatureFor(nonce: string): string {
  return createHmac('sha256', getEnv().CSRF_SECRET).update(nonce).digest('base64url');
}

export function issueCsrfToken(): string {
  const nonce = createHmac('sha256', getEnv().CSRF_SECRET)
    .update(`${Date.now()}:${Math.random()}:${process.pid}`)
    .digest('base64url');
  return `${nonce}.${signatureFor(nonce)}`;
}

export function isWellFormedCsrfToken(token: string): boolean {
  const [nonce, signature] = token.split('.');
  if (!nonce || !signature) return false;
  const expected = signatureFor(nonce);
  const left = Buffer.from(signature, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function issueAndStoreCsrfToken(): Promise<string> {
  const token = issueCsrfToken();
  await setCsrfCookie(token);
  return token;
}

export async function readCsrfCookie(): Promise<string | undefined> {
  return readCookie(CSRF_COOKIE);
}

export function verifyCsrfToken(
  headerToken: string | null | undefined,
  cookieToken: string | null | undefined,
): boolean {
  if (!headerToken || !cookieToken) return false;
  if (!isWellFormedCsrfToken(cookieToken) || !isWellFormedCsrfToken(headerToken)) return false;
  const left = Buffer.from(headerToken, 'utf8');
  const right = Buffer.from(cookieToken, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
