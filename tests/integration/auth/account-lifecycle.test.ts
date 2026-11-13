import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { registerVerifiedUser, TestSession } from '../../helpers/client';
import {
  drainAccountDeletionJobs,
  generateLessonForMaterial,
  materialJobsFor,
  resetPipelineState,
  runPipeline,
} from '../../helpers/pipeline';
import { uploadToFakeS3, confirmMaterial } from '../../helpers/storage-fake';
import { TEXT_MATERIAL_BYTES } from '../../fixtures/materials';
import { processDeleteAccount } from '@/worker/processors/delete-account';
import { User } from '@/lib/db/models/user';
import { Material } from '@/lib/db/models/material';
import { RefreshToken } from '@/lib/db/models/refresh-token';
import type { DeleteAccountJob } from '@/lib/jobs/schemas';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

describe('account lifecycle', () => {
  it('blocks uploads from unverified users with the unverified_email code', async () => {
    const session = new TestSession(appUrl);
    const email = `unverified-${Date.now()}@example.com`;
    await session.post('/api/auth/register', { email, password: 'correct horse battery staple' });
    await session.post('/api/auth/login', { email, password: 'correct horse battery staple' });

    const presign = await session.post('/api/materials/presign', {
      filename: 'notes.md',
      declaredMime: 'text/markdown',
      sizeBytes: 42,
    });
    expect(presign.status).toBe(403);
    expect(presign.body).toMatchObject({ code: 'unverified_email' });
  });

  it('exports owned content as a downloadable archive', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'export-me.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline();
    // The export archive includes generated lessons; request one explicitly.
    await generateLessonForMaterial(upload.materialId, user.user.id);

    const response = await user.session.binaryGet('/api/account/export');
    expect(response.status).toBe(200);
    expect(String(response.headers['content-type'] ?? '')).toContain('application/zip');
    const body = Buffer.from(response.body as Buffer);
    expect(body.byteLength).toBeGreaterThan(80);
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('requests deletion, ends access immediately, and cascades cleanly', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'cascade-me.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline();

    const deletion = await user.session.delete('/api/account');
    expect(deletion.status).toBe(202);
    expect(deletion.body).toMatchObject({ status: 'queued' });

    const denied = await user.session.get('/api/me');
    expect(denied.status).toBe(401);

    const job = drainAccountDeletionJobs().find(
      (payload) => payload.userId === user.user.id,
    ) as DeleteAccountJob | undefined;
    expect(job).toBeDefined();
    await processDeleteAccount(job!);

    const userDoc = await User.findById(user.user.id)
      .select('email status deletedAt')
      .lean<{ status: string; email: string }>()
      .exec();
    expect(userDoc?.status).toBe('deleted');
    expect(userDoc?.email).toContain('@deleted.invalid');
    expect(await Material.countDocuments({ userId: user.user.id })).toBe(0);
    expect(await RefreshToken.countDocuments({ userId: user.user.id })).toBe(0);
  });

  it('shows the session user the same non-revealing surface for missing resources', async () => {
    const user = await registerVerifiedUser(appUrl);
    const materialId = `${'a'.repeat(23)}b`;
    const missing = await user.session.get(`/api/materials/${materialId}`);
    const lessonMissing = await user.session.get(`/api/lessons/${materialId}`);
    void materialJobsFor;
    expect(missing.status).toBe(404);
    expect(lessonMissing.status).toBe(404);
    expect(missing.body).toHaveProperty('correlationId');
  });
});
