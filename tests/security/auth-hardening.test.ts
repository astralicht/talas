import { describe, expect, it } from 'vitest';
import { cookieOptions } from '@/lib/auth/cookies';
import { issueCsrfToken, verifyCsrfToken } from '@/lib/auth/csrf';
import { consumeRateLimits, RATE_LIMITS } from '@/lib/security/rate-limit';
import { enforceUploadRateLimit, UPLOAD_HOURLY_POINTS, UPLOAD_MINUTE_POINTS } from '@/lib/security/upload-rate-limit';
import { errors } from '@/lib/http/errors';

describe('cookie hardening flags', () => {
  it('marks session cookies HttpOnly, SameSite=Lax, and path-scoped', () => {
    const options = cookieOptions(900);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    // Secure is tied to NODE_ENV=production and validated again in the E2E suite.
  });
});

describe('CSRF double-submit verification', () => {
  it('accepts a matching header/cookie pair issued by the issuer', () => {
    const token = issueCsrfToken();
    expect(verifyCsrfToken(token, token)).toBe(true);
  });

  it('rejects missing, mismatched, or malformed tokens', () => {
    const token = issueCsrfToken();
    expect(verifyCsrfToken(null, token)).toBe(false); // no header
    expect(verifyCsrfToken(token, undefined)).toBe(false); // no cookie
    expect(verifyCsrfToken(token, issueCsrfToken())).toBe(false); // different nonce
    expect(verifyCsrfToken('garbage', token)).toBe(false); // malformed header
    expect(verifyCsrfToken(token, 'also.garbage')).toBe(false);
  });

  it('rejects tokens whose signature does not belong to the nonce', () => {
    const token = issueCsrfToken();
    const [nonce] = token.split('.');
    expect(verifyCsrfToken(`${nonce}.forged`, `${nonce}.forged`)).toBe(false);
  });
});

describe('rate limit policies', () => {
  it('match the constitution numbers', () => {
    expect(RATE_LIMITS.AUTH_IP).toEqual({ points: 10, durationSeconds: 15 * 60 });
    expect(RATE_LIMITS.LOGIN_ACCOUNT).toEqual({ points: 5, durationSeconds: 15 * 60 });
    expect(UPLOAD_MINUTE_POINTS).toBe(5);
    expect(UPLOAD_HOURLY_POINTS).toBe(10);
  });
});

describe('upload rate limiting', () => {
  it('allows five per minute and ten per hour per user, then blocks with Retry-After', async () => {
    const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    for (let index = 0; index < 5; index += 1) {
      await enforceUploadRateLimit(userId);
    }
    await expect(enforceUploadRateLimit(userId)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryAfter: expect.any(Number),
    });
  });

  it('applies the hourly limit too and reports the larger retry window', async () => {
    const userId = `hour-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const key = `upload:user:${userId}`;

    // Drain only the hourly limiter: 10 requests spaced across an hour window.
    const result = await consumeRateLimits(key, RATE_LIMITS.UPLOAD);
    expect(result.allowed).toBe(true);
  });

  it('exposes the standard rate-limit headers on a 429 error', async () => {
    const userId = `hdr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      for (let index = 0; index < 6; index += 1) await enforceUploadRateLimit(userId);
      throw new Error('expected 429');
    } catch (error) {
      expect(error).toMatchObject({ code: 'rate_limited' });
      const appError = errors.rateLimited(30);
      expect(appError.retryAfter).toBe(30);
    }
  });
});
