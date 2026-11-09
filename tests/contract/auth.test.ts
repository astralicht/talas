import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { TestSession, registerVerifiedUser } from '../helpers/client';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

describe('auth contract', () => {
  it('serves the csrf pair as HttpOnly cookie plus JSON token', async () => {
    const session = new TestSession(appUrl);
    const response = await session.get('/api/auth/csrf');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ csrfToken: expect.any(String) });
    expect(session.cookie('csrf_token')).toBeDefined();
  });

  it('registers, verifies, signs in, and exposes /api/me with the 4-field user view', async () => {
    const { session, user } = await registerVerifiedUser(appUrl);
    expect(user.email).toMatch(/@example\.com$/);
    expect(user.emailVerified).toBe(true);
    expect(Object.keys(user).sort()).toEqual(['createdAt', 'email', 'emailVerified', 'id']);

    const me = await session.get('/api/me');
    expect(me.status).toBe(200);
    expect(Object.keys(me.body).sort()).toEqual(['createdAt', 'email', 'emailVerified', 'id']);
  });

  it('rejects registration when a required field is present as an unknown key', async () => {
    const session = new TestSession(appUrl);
    const response = await session.post('/api/auth/register', {
      email: 'intruder@example.com',
      password: 'correct horse battery staple',
      isAdmin: true,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
  });

  it('returns the safe error envelope with a correlation id on failures', async () => {
    const session = new TestSession(appUrl);
    const response = await session.post('/api/auth/login', {
      email: 'nobody-here@example.com',
      password: 'correct horse battery staple',
    });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      code: expect.any(String),
      message: expect.any(String),
      correlationId: expect.any(String),
    });
  });

  it('signs out and the session no longer grants access', async () => {
    const { session } = await registerVerifiedUser(appUrl);
    const logout = await session.post('/api/auth/logout');
    expect(logout.status).toBe(204);

    const me = await session.get('/api/me');
    expect(me.status).toBe(401);
  });
});
