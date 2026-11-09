import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_AUDIENCE,
  JWT_ISSUER,
  REFRESH_TOKEN_TTL_SECONDS,
  accessTokenExpiry,
  generateOpaqueToken,
  hashToken,
  refreshTokenExpiry,
  signAccessToken,
  verifyAccessToken,
} from '@/lib/auth/tokens';

describe('access tokens', () => {
  it('are 15-minute HS256 JWTs with issuer and audience claims', async () => {
    const token = await signAccessToken({ userId: '507f1f77bcf86cd799439011', email: 'a@example.com' });
    const claims = await verifyAccessToken(token);
    expect(claims.userId).toBe('507f1f77bcf86cd799439011');
    expect(claims.email).toBe('a@example.com');
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);

    const lifetime = claims.expiresAt - claims.issuedAt;
    expect(lifetime).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(JWT_ISSUER).toBe('talas');
    expect(JWT_AUDIENCE).toBe('talas-web');
  });

  it('rejects tampered tokens', async () => {
    const token = await signAccessToken({ userId: '507f1f77bcf86cd799439011', email: 'a@example.com' });
    const tampered = `${token.slice(0, -4)}AAAA`;
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });

  it('expires access tokens within 15 minutes of issue', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expiry = accessTokenExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(15 * 60 * 1000);
  });
});

describe('refresh tokens', () => {
  it('expire at most 7 days after creation', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expiry = refreshTokenExpiry(now);
    expect(expiry.getTime()).toBe(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(REFRESH_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(7 * 24 * 60 * 60);
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
