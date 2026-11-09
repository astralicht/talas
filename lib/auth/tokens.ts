import { SignJWT } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { ACCESS_TOKEN_TTL_SECONDS, JWT_ISSUER, JWT_AUDIENCE } from './access-token';
import type { AccessTokenClaims } from './access-token';

// Re-exported for existing Node-side callers; the edge-safe implementations
// live in `lib/auth/access-token.ts` (no `node:crypto` there, so the
// middleware bundle can import it).
export {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_ISSUER,
  JWT_AUDIENCE,
  type AccessTokenClaims,
  type VerifiedAccessToken,
  verifyAccessToken,
} from './access-token';

export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

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
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessSecret());
}

export function generateOpaqueToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}

export function accessTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000);
}
