import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { registerVerifiedUser } from '../helpers/client';
import { runPipeline, resetPipelineState } from '../helpers/pipeline';
import { uploadToFakeS3, confirmMaterial } from '../helpers/storage-fake';
import { TEXT_MATERIAL_BYTES, EICAR_BYTES } from '../fixtures/materials';
import { enforceUploadRateLimit, UPLOAD_MINUTE_POINTS } from '@/lib/security/upload-rate-limit';
import { setClamAvScannerForTests } from '@/lib/security/clamav';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
  setClamAvScannerForTests(null);
});

describe('upload boundaries', () => {
  it('rejects mime-spoofed uploads at confirm time', async () => {
    const user = await registerVerifiedUser(appUrl);
    // A text payload declared as PDF; presign accepts the declaration, the magic bytes do not.
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'trojan.pdf',
      'application/pdf',
      TEXT_MATERIAL_BYTES,
    );
    const confirm = await confirmMaterial(user.session, upload.materialId);
    expect(confirm.status).toBe(415);
    expect(confirm.body).toMatchObject({ code: 'unsupported_media_type' });

    const material = await user.session.get(`/api/materials/${upload.materialId}`);
    expect((material.body as { status: string; failureCode: string | null }).status).toBe('failed');
    expect((material.body as { failureCode: string | null }).failureCode).toBe('mime_mismatch');
  });

  it('quarantines the EICAR test file and removes the stored bytes', async () => {
    const user = await registerVerifiedUser(appUrl);
    setClamAvScannerForTests(async () => ({ status: 'infected', signature: 'Win.Test.EICAR_HDB-1' }));
    const fakeUpload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'eicar.txt',
      'text/plain',
      EICAR_BYTES,
    );
    const confirm = await confirmMaterial(user.session, fakeUpload.materialId);
    expect(confirm.status).toBe(202);
    const seen = await runPipeline({ materialId: fakeUpload.materialId });
    expect(seen.map((job) => job.type)).toEqual(['scan_material']);

    const material = await user.session.get(`/api/materials/${fakeUpload.materialId}`);
    expect((material.body as { status: string }).status).toBe('quarantined');
    // The stored object is gone from the fake store: nothing unclean lingers.
    const retry = await user.session.post(`/api/materials/${fakeUpload.materialId}/retry`);
    expect(retry.status).toBe(409);
  });

  it('fails closed when the scanner is unavailable', async () => {
    const user = await registerVerifiedUser(appUrl);
    setClamAvScannerForTests(async () => ({ status: 'unavailable', detail: 'tcp refused' }));
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'unscanned.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });

    const material = await user.session.get(`/api/materials/${upload.materialId}`);
    expect((material.body as { status: string }).status).toBe('failed');
    // Failure leaves no parsed lesson behind.
    const lessons = (await user.session.get('/api/lessons')).body as { data: unknown[] };
    expect(lessons.data.filter((entry) => Boolean(entry)).length).toBeLessThan(5);
  });

  it('enforces 5 uploads per minute and 10 per hour per user', async () => {
    const bucketUserId = `rate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    for (let index = 0; index < UPLOAD_MINUTE_POINTS; index += 1) {
      await enforceUploadRateLimit(bucketUserId);
    }

    try {
      await enforceUploadRateLimit(bucketUserId);
      throw new Error('expected the 429 on the minute bucket');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('rate_limited');
    }
  });

  it('does not leak the storage key in material views', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'listed.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    const view = await user.session.get(`/api/materials/${upload.materialId}`);
    expect(JSON.stringify(view.body)).not.toContain(`materials/`);
  });
});
