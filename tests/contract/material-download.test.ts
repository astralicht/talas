import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { registerVerifiedUser } from '../helpers/client';
import { runPipeline, resetPipelineState } from '../helpers/pipeline';
import { uploadToFakeS3, confirmMaterial } from '../helpers/storage-fake';
import { TEXT_MATERIAL_BYTES } from '../fixtures/materials';
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

describe('material download endpoint', () => {
  it('streams the original bytes back to the owner with attachment headers', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'source.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, upload.materialId);

    const response = await user.session.binaryGet(`/api/materials/${upload.materialId}/download`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/markdown');
    expect(response.headers['content-disposition']).toBe('attachment; filename="source.md"');
    expect(response.headers['cache-control']).toContain('no-store');
    expect((response.body as Buffer).equals(TEXT_MATERIAL_BYTES)).toBe(true);
  });

  it('404s unknown and foreign material ids non-revealingly', async () => {
    const user = await registerVerifiedUser(appUrl);
    const other = await registerVerifiedUser(appUrl);

    const own = await uploadToFakeS3(
      user.session,
      user.user.id,
      'private.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, own.materialId);

    const foreign = await other.session.binaryGet(`/api/materials/${own.materialId}/download`);
    expect(foreign.status).toBe(404);
    expect((foreign.body as { id?: string }).id ?? '').not.toContain('private');

    const unknownId = 'f'.repeat(23) + '9';
    const unknown = await user.session.get(`/api/materials/${unknownId}/download`);
    expect(unknown.status).toBe(404);
  });

  it('never serves quarantined materials', async () => {
    const user = await registerVerifiedUser(appUrl);
    setClamAvScannerForTests(async () => ({
      status: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    }));
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'eicar.txt',
      'text/plain',
      Buffer.from('infected-content', 'utf8'),
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });

    const material = await user.session.get(`/api/materials/${upload.materialId}`);
    expect((material.body as { status: string }).status).toBe('quarantined');

    const download = await user.session.get(`/api/materials/${upload.materialId}/download`);
    expect(download.status).toBe(404);
  });

  it('rejects malformed material ids with 400', async () => {
    const user = await registerVerifiedUser(appUrl);
    const response = await user.session.get('/api/materials/not-an-id/download');
    expect(response.status).toBe(400);
  });
});
