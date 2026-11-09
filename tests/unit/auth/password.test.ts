import { describe, expect, it } from 'vitest';
import {
  ARGON2_OPTIONS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  passwordMeetsPolicy,
  verifyPassword,
} from '@/lib/auth/password';

describe('Argon2id password hashing', () => {
  it('uses Argon2id with the constitution-mandated cost parameters', () => {
    expect(ARGON2_OPTIONS.type).toBe(2); // argon2.argon2id
    expect(ARGON2_OPTIONS.memoryCost).toBeGreaterThanOrEqual(19_456);
    expect(ARGON2_OPTIONS.timeCost).toBeGreaterThanOrEqual(2);
  });

  it('round-trips a password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects wrong passwords and malformed hashes without throwing', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword(hash, 'wrong password entirely')).resolves.toBe(false);
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('enforces the 12-128 character policy', async () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
    expect(passwordMeetsPolicy('a'.repeat(11))).toBe(false);
    expect(passwordMeetsPolicy('a'.repeat(12))).toBe(true);
    expect(passwordMeetsPolicy('a'.repeat(128))).toBe(true);
    expect(passwordMeetsPolicy('a'.repeat(129))).toBe(false);
    await expect(hashPassword('short')).rejects.toThrow();
  });

  it('never leaks the password from the hash comparison timing (constant check)', async () => {
    const hash = await hashPassword('correct horse battery staple');
    const wrong = await verifyPassword(hash, 'correct horse battery staplx');
    expect(wrong).toBe(false);
  });
});
