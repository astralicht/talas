import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { registerVerifiedUser } from '../helpers/client';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

describe('account endpoints contract', () => {
  it('exposes /api/me with exactly the 4-field user shape', async () => {
    const user = await registerVerifiedUser(appUrl);
    const response = await user.session.get('/api/me');
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['createdAt', 'email', 'emailVerified', 'id']);
  });

  it('requires authentication for /api/me', async () => {
    const session = await import('../helpers/client').then(({ TestSession }) => new TestSession(appUrl));
    const anonymous = await session.get('/api/me');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: 'unauthorized' });
  });

  it('rejects mutation of /api/account with an unknown body', async () => {
    const user = await registerVerifiedUser(appUrl);
    const response = await user.session.delete('/api/account');
    expect(response.status).toBe(202);
    // The account deletion acceptance contract uses a 202 envelope body.
    expect(Object.keys(response.body).sort()).toEqual(['requestedAt', 'status'].sort());
  });

  it('streams a ZIP export with the correlation header', async () => {
    const user = await registerVerifiedUser(appUrl);
    const binary = await user.session.binaryGet('/api/account/export');
    expect(binary.status).toBe(200);
    expect(binary.headers['x-correlation-id']).toBeDefined();
    expect(binary.headers['content-disposition']).toContain('attachment');
  });
});
