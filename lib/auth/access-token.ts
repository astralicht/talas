import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { getEnv } from '@/lib/env';

/**
 * Edge-safe access-token and session-renewal-nonce primitives. This module MUST
 * stay free of Node-only imports (`node:crypto`, mongoose) so the middleware
 * bundle can verify JWTs without a database round-trip.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const JWT_ISSUER = 'talas';
export const JWT_AUDIENCE = 'talas-web';
export const RENEW_NONCE_AUDIENCE = 'talas-renew';
/** Renew nonces are single navigation hops; a minute is generous. */
export const RENEW_NONCE_TTL_SECONDS = 60;

export interface AccessTokenClaims {
  userId: string;
  email: string;
}

export interface VerifiedAccessToken extends AccessTokenClaims {
  issuedAt: number;
  expiresAt: number;
}

function accessSecret(): Uint8Array {
  return new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);
}

function accessTokenFromPayload(payload: JWTPayload): VerifiedAccessToken {
  if (
    payload.type !== 'access' ||
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    throw new Error('Invalid access token claims');
  }
  return {
    userId: payload.sub,
    email: payload.email,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

/** Verifies signature, issuer, audience, and type claims. Edge-safe. */
export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  const { payload } = await jwtVerify(token, accessSecret(), {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    clockTolerance: 5,
    algorithms: ['HS256'],
  });

  return accessTokenFromPayload(payload);
}

/**
 * Short-lived signed state for the middleware-initiated silent session renewal.
 * Binds the renew hop to the exact destination path so the hop cannot be aimed
 * elsewhere, and expires quickly.
 */
export async function signRenewNonce(input: { next: string }): Promise<string> {
  return new SignJWT({ type: 'renew', next: input.next })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(JWT_ISSUER)
    .setAudience(RENEW_NONCE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${RENEW_NONCE_TTL_SECONDS}s`)
    .sign(accessSecret());
}

export async function verifyRenewNonce(
  token: string,
): Promise<{ next: string } | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret(), {
      issuer: JWT_ISSUER,
      audience: RENEW_NONCE_AUDIENCE,
      clockTolerance: 0,
      algorithms: ['HS256'],
    });
    if (
      payload.type !== 'renew' ||
      typeof payload.next !== 'string' ||
      !payload.next.startsWith('/')
    ) {
      return null;
    }
    return { next: payload.next };
  } catch {
    return null;
  }
}
