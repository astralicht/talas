import { describe, expect, it } from 'vitest';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  accessTokenExpiry,
  accessTokenTtlSeconds,
  generateOpaqueToken,
  hashToken,
  refreshTokenExpiry,
  refreshTokenTtlSeconds,
  signAccessToken,
  verifyAccessToken,
} from '@/lib/auth/tokens';
import { signRenewNonce, verifyRenewNonce } from '@/lib/auth/access-token';
import { loadEnv, resetEnvCache } from '@/lib/env';

describe('access tokens', () => {
  it('are 24-hour-by-default HS256 JWTs with issuer and audience claims', async () => {
    const token = await signAccessToken({ userId: '507f1f77bcf86cd799439011', email: 'a@example.com' });
    const claims = await verifyAccessToken(token);
    expect(claims.userId).toBe('507f1f77bcf86cd799439011');
    expect(claims.email).toBe('a@example.com');

    const lifetime = claims.expiresAt - claims.issuedAt;
    expect(lifetime).toBe(accessTokenTtlSeconds());
    // Constitution v2.0.0 default: 24 hours.
    expect(accessTokenTtlSeconds()).toBe(24 * 60 * 60);
    expect(JWT_ISSUER).toBe('talas');
    expect(JWT_AUDIENCE).toBe('talas-web');
  });

  it('rejects tampered tokens', async () => {
    const token = await signAccessToken({ userId: '507f1f77bcf86cd799439011', email: 'a@example.com' });
    const tampered = `${token.slice(0, -4)}AAAA`;
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });

  it('expires access tokens after the configured TTL, at most 24 hours', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expiry = accessTokenExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(accessTokenTtlSeconds() * 1000);
    expect(accessTokenTtlSeconds()).toBeLessThanOrEqual(24 * 60 * 60);
  });
});

describe('refresh tokens', () => {
  it('expire 30 days after creation by default, at most 30 days', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expiry = refreshTokenExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(refreshTokenTtlSeconds() * 1000);
    // Constitution v2.0.0 default and hard cap: 30 days.
    expect(refreshTokenTtlSeconds()).toBe(30 * 24 * 60 * 60);
    expect(refreshTokenTtlSeconds()).toBeLessThanOrEqual(30 * 24 * 60 * 60);
  });

  it('generate opaque tokens and store only SHA-256 hashes', () => {
    const token = generateOpaqueToken();
    expect(token).not.toMatch(/[+/=]/); // base64url
    const hash = hashToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    // Same token always hashes to the same value (lookup key).
    expect(hashToken(token)).toBe(hash);
  });
});

describe('renew nonce redirect guard', () => {
  it('verifies a bound same-origin destination path', async () => {
    const nonce = await signRenewNonce({ next: '/dashboard?tab=overview' });
    expect(await verifyRenewNonce(nonce)).toEqual({ next: '/dashboard?tab=overview' });
  });

  it('rejects protocol-relative destinations (open-redirect guard)', async () => {
    const nonce = await signRenewNonce({ next: '//evil.example/dashboard' });
    expect(await verifyRenewNonce(nonce)).toBeNull();
  });
});

describe('session TTL configuration', () => {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    SESSION_ACCESS_TTL_SECONDS: '900',
    SESSION_REFRESH_TTL_SECONDS: '3600',
  };

  it('coerces and accepts in-bounds values', () => {
    resetEnvCache();
    try {
      const parsed = loadEnv(base);
      expect(parsed.SESSION_ACCESS_TTL_SECONDS).toBe(900);
      expect(parsed.SESSION_REFRESH_TTL_SECONDS).toBe(3600);
    } finally {
      resetEnvCache();
    }
  });

  it('rejects out-of-bounds or refresh-below-access configurations', () => {
    const invalid: Array<Record<string, string>> = [
      { SESSION_ACCESS_TTL_SECONDS: '299' }, // below the 5-minute floor
      { SESSION_ACCESS_TTL_SECONDS: '86401' }, // above the 24-hour cap
      { SESSION_REFRESH_TTL_SECONDS: '3599' }, // below the 1-hour floor
      { SESSION_REFRESH_TTL_SECONDS: '2592001' }, // above the 30-day cap
      { SESSION_REFRESH_TTL_SECONDS: '600' }, // shorter than the access TTL
      { SESSION_ACCESS_TTL_SECONDS: 'not-a-number' },
    ];
    for (const override of invalid) {
      resetEnvCache();
      try {
        expect(() => loadEnv({ ...base, ...override })).toThrow(
          /Invalid environment configuration/,
        );
      } finally {
        resetEnvCache();
      }
    }
  });
});
