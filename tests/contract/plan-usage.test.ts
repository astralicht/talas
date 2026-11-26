import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { registerVerifiedUser, TestSession, type RegisteredUser } from '../helpers/client';
import { Types } from 'mongoose';
import { Material } from '@/lib/db/models/material';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

async function seedMaterials(user: RegisteredUser, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const materialId = new Types.ObjectId();
    await Material.create({
      _id: materialId,
      userId: new Types.ObjectId(user.user.id),
      originalFilename: `contract-${index}.md`,
      storageKey: `materials/${user.user.id}/${materialId.toHexString()}`,
      declaredMime: 'text/markdown',
      sizeBytes: 150 * 1024 * 1024,
      status: 'ready',
      scanResult: 'clean',
      charCount: 100,
      uploadExpiresAt: new Date(),
    });
  }
}

describe('plan usage endpoint and quota envelope', () => {
  it('answers anonymous usage requests with the auth envelope', async () => {
    const anonymous = new TestSession(appUrl);
    const response = await anonymous.get('/api/me/usage');
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      code: 'unauthorized',
      correlationId: expect.any(String),
    });
  });

  it('serves the free-plan quota snapshot with a stable shape', async () => {
    const user = await registerVerifiedUser(appUrl);
    const response = await user.session.get('/api/me/usage');
    expect(response.status).toBe(200);

    const body = response.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'generations',
      'lessons',
      'maxMaterialChars',
      'plan',
      'storage',
    ]);
    expect(body.plan).toBe('free');
    expect(body.storage).toEqual({ used: 0, limit: 1 * 1024 * 1024 * 1024 });
    expect(body.lessons).toEqual({ used: 0, limit: 3 });
    expect(body.maxMaterialChars).toBe(10_000);
    expect(body.generations).toMatchObject({ used: 0, limit: 3 });
    // resetsAt is the next UTC midnight.
    expect(
      ((body.generations as { resetsAt: string }).resetsAt ?? '').endsWith('T00:00:00.000Z'),
    ).toBe(true);
  });

  it('rejects quota-exceeded uploads with the plan_limit 403 envelope', async () => {
    const user = await registerVerifiedUser(appUrl);
    await seedMaterials(user, 8);

    const response = await user.session.post('/api/materials/presign', {
      filename: 'blocked.md',
      declaredMime: 'text/markdown',
      sizeBytes: 100,
    });
    expect(response.status).toBe(403);
    const body = response.body as {
      code: string;
      message: string;
      correlationId: string;
      details?: Record<string, unknown>;
    };
    expect(body.code).toBe('plan_limit');
    expect(body.correlationId).toBeTruthy();
    expect(body.message).toContain('free');
    expect(body.details).toMatchObject({
      reason: 'plan_storage_limit',
      purged: 0,
    });
  });
});
