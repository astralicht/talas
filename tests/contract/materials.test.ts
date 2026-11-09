import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { registerVerifiedUser } from '../helpers/client';
import { resetPipelineState } from '../helpers/pipeline';
import { confirmMaterial, materialStatus, uploadToFakeS3, type MaterialView } from '../helpers/storage-fake';
import { TEXT_MATERIAL_BYTES } from '../fixtures/materials';
import { runPipeline } from '../helpers/pipeline';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

describe('materials endpoints contract', () => {
  it('lists materials in the MaterialList shape', async () => {
    const user = await registerVerifiedUser(appUrl);
    await uploadToFakeS3(user.session, user.user.id, 'list.md', 'text/markdown', TEXT_MATERIAL_BYTES);
    const response = await user.session.get('/api/materials');
    expect(response.status).toBe(200);
    const body = response.body as { data: MaterialView[]; page: number; limit: number; total: number };
    expect(Object.keys(body).sort()).toEqual(['data', 'limit', 'page', 'total']);
    expect(body.limit).toBe(20);
    expect(body.data.length).toBeGreaterThan(0);
    const view = body.data[0]!;
    expect(Object.keys(view).sort()).toEqual(
      [
        'createdAt',
        'detectedMime',
        'failureCode',
        'failureMessage',
        'id',
        'originalFilename',
        'pageCount',
        'scanResult',
        'sizeBytes',
        'status',
      ].sort(),
    );
  });

  it('paginates with page and limit', async () => {
    const user = await registerVerifiedUser(appUrl);
    const page = await user.session.get('/api/materials?page=1&limit=1');
    expect(page.status).toBe(200);
    const body = page.body as { page: number; limit: number };
    expect(body.page).toBe(1);
    expect(body.limit).toBe(1);

    const bad = await user.session.get('/api/materials?limit=51');
    expect(bad.status).toBe(400);
  });

  it('validates presign input strictly', async () => {
    const user = await registerVerifiedUser(appUrl);
    const wrongMime = await user.session.post('/api/materials/presign', {
      filename: 'a.exe',
      declaredMime: 'application/x-msdownload',
      sizeBytes: 10,
    });
    expect(wrongMime.status).toBe(400);

    const tooBig = await user.session.post('/api/materials/presign', {
      filename: 'a.pdf',
      declaredMime: 'application/pdf',
      sizeBytes: 26_214_401,
    });
    expect(tooBig.status).toBe(400);

    const pathTraversal = await user.session.post('/api/materials/presign', {
      filename: '../../etc/passwd',
      declaredMime: 'text/plain',
      sizeBytes: 10,
    });
    expect(pathTraversal.status).toBe(400);
  });

  it('returns the presigned contract shape with 15-minute expiry', async () => {
    const user = await registerVerifiedUser(appUrl);
    const response = await user.session.post('/api/materials/presign', {
      filename: 'contract.md',
      declaredMime: 'text/markdown',
      sizeBytes: 128,
    });
    expect(response.status).toBe(201);
    const presigned = response.body as {
      materialId: string;
      uploadUrl: string;
      method: string;
      headers: Record<string, string>;
      expiresAt: string;
    };
    expect(Object.keys(presigned).sort()).toEqual(
      ['expiresAt', 'headers', 'materialId', 'method', 'uploadUrl'].sort(),
    );
    expect(presigned.method).toBe('PUT');
    expect(presigned.headers['Content-Type']).toBe('text/markdown');
    expect(Date.parse(presigned.expiresAt) - Date.now()).toBeGreaterThan(14.5 * 60 * 1000);
  });

  it('404s unknown/foreign material ids non-revealingly', async () => {
    const user = await registerVerifiedUser(appUrl);
    const foreign = 'f'.repeat(23) + '9';
    const single = await user.session.get(`/api/materials/${foreign}`);
    const status = await materialStatus(user.session, foreign);
    const materialDelete = await user.session.delete(`/api/materials/${foreign}`);
    expect(single.status).toBe(404);
    expect(status.status).toBe(404);
    expect(materialDelete.status).toBe(404);
  });

  it('refuses confirming a foreign material id', async () => {
    const user = await registerVerifiedUser(appUrl);
    const other = await registerVerifiedUser(appUrl);
    const foreign = await uploadToFakeS3(
      other.session,
      other.user.id,
      'theirs.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    const response = await confirmMaterial(user.session, foreign.materialId);
    expect(response.status).toBe(404);
    await runPipeline({ materialId: foreign.materialId });
  });

  it('answers the ProcessingStatus shape on the status endpoint', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToFakeS3(user.session, user.user.id, 'status.md', 'text/markdown', TEXT_MATERIAL_BYTES);
    const response = await materialStatus(user.session, upload.materialId);
    expect(response.status).toBe(200);
    const body = response.body as { materialId?: string; status: string; attempts: number; updatedAt: string };
    expect(body.status).toBe('awaiting_upload');
    expect(body.attempts).toBe(0);
    expect(body.updatedAt).toBeDefined();
    expect(body.materialId).toBeUndefined(); // ProcessingStatus has no materialId duplication by design here
  });
});
