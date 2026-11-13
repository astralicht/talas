import { SignJWT } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { accessTokenTtlSeconds, JWT_ISSUER, JWT_AUDIENCE } from './access-token';
import type { AccessTokenClaims } from './access-token';

// Re-exported for existing Node-side callers; the edge-safe implementations
// live in `lib/auth/access-token.ts` (no `node:crypto` there, so the
// middleware bundle can import it).
export {
  accessTokenTtlSeconds,
  JWT_ISSUER,
  JWT_AUDIENCE,
  type AccessTokenClaims,
  type VerifiedAccessToken,
  verifyAccessToken,
} from './access-token';

/**
 * Constitution v2.0.0: the refresh-token TTL is environment-configurable with
 * bounded validation (`SESSION_REFRESH_TTL_SECONDS`, 1 h to 30 d) and defaults
 * to the constitutional maximum of 30 days. The env schema guarantees it is
 * never shorter than the access-token TTL.
 */
export function refreshTokenTtlSeconds(): number {
  return getEnv().SESSION_REFRESH_TTL_SECONDS;
}

function accessSecret(): Uint8Array {
  return new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email, type: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${accessTokenTtlSeconds()}s`)
    .sign(accessSecret());
}

export function generateOpaqueToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + refreshTokenTtlSeconds() * 1000);
}

export function accessTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + accessTokenTtlSeconds() * 1000);
}
