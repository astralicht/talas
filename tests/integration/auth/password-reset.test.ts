import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { latestLinkToken, registerVerifiedUser, TestSession } from '../../helpers/client';
import { User } from '@/lib/db/models/user';
import { PasswordResetToken } from '@/lib/db/models/password-reset-token';
import { hashToken } from '@/lib/auth/tokens';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

describe('password reset', () => {
  it('is non-revealing for unknown emails', async () => {
    const session = new TestSession(appUrl);
    const response = await session.post('/api/auth/forgot-password', {
      email: 'ghost@example.com',
    });
    expect(response.status).toBe(202);
  });

  it('completes single-use reset with a new password', async () => {
    const user = await registerVerifiedUser(appUrl);
    await user.session.post('/api/auth/forgot-password', { email: user.email });

    const token = await latestLinkToken(user.email, 'Reset your Talas password');
    const reset = await user.session.post('/api/auth/reset-password', {
      token,
      password: 'a-new-strong-password-123',
    });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ status: 'ok' });

    // Old password fails; new one works.
    const oldLogin = await user.session.post('/api/auth/login', {
      email: user.email,
      password: user.password,
    });
    expect(oldLogin.status).toBe(401);

    const freshSession = new TestSession(appUrl);
    const newLogin = await freshSession.post('/api/auth/login', {
      email: user.email,
      password: 'a-new-strong-password-123',
    });
    expect(newLogin.status).toBe(200);
  });

  it('rejects reuse of the same reset token', async () => {
    const user = await registerVerifiedUser(appUrl);
    await user.session.post('/api/auth/forgot-password', { email: user.email });
    const token = await latestLinkToken(user.email, 'Reset your Talas password');

    const first = await user.session.post('/api/auth/reset-password', {
      token,
      password: 'the-second-password-789',
    });
    expect(first.status).toBe(200);

    const second = await user.session.post('/api/auth/reset-password', {
      token,
      password: 'the-third-password-000',
    });
    expect(second.status).toBe(400);
  });

  it('rejects expired reset tokens (30-minute expiry)', async () => {
    const user = await registerVerifiedUser(appUrl);
    await user.session.post('/api/auth/forgot-password', { email: user.email });
    const token = await latestLinkToken(user.email, 'Reset your Talas password');

    // Force the token's expiry into the past.
    const userDoc = await User.findOne({ email: user.email }).lean<{ _id: unknown }>().exec();
    await PasswordResetToken.updateOne(
      { tokenHash: hashToken(token), userId: userDoc?._id as never },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    ).exec();

    const expired = await user.session.post('/api/auth/reset-password', {
      token,
      password: 'expired-but-valid-form-11',
    });
    expect(expired.status).toBe(400);
  });

  it('revokes refresh sessions after a reset', async () => {
    const user = await registerVerifiedUser(appUrl);
    const oldSession = new TestSession(appUrl);
    await oldSession.post('/api/auth/login', { email: user.email, password: user.password });

    await user.session.post('/api/auth/forgot-password', { email: user.email });
    const token = await latestLinkToken(user.email, 'Reset your Talas password');
    await user.session.post('/api/auth/reset-password', {
      token,
      password: 'rotated-password-444',
    });

    // The pre-reset session's refresh must no longer be accepted.
    const refresh = await oldSession.post('/api/auth/refresh');
    expect([401, 403]).toContain(refresh.status);
  });
});
