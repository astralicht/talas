import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import {
  registerVerifiedUser,
  TestSession,
} from '../../helpers/client';
import { confirmMaterial, materialStatus } from '../../helpers/storage-fake';
import { runPipeline, resetPipelineState } from '../../helpers/pipeline';
import { TEXT_MATERIAL_BYTES } from '../../fixtures/materials';
import { Material } from '@/lib/db/models/material';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

async function presign(
  session: TestSession,
  sizeBytes: number,
  filename = 'upload-route.md',
): Promise<{ response: Awaited<ReturnType<TestSession['post']>>; materialId?: string }> {
  const response = await session.post('/api/materials/presign', {
    filename,
    declaredMime: 'text/markdown',
    sizeBytes,
  });
  const materialId =
    response.status === 201 ? (response.body as { materialId: string }).materialId : undefined;
  return { response, materialId };
}

interface StatusView {
  status: string;
  failureCode: string | null;
}

describe('material upload route (proxied transport, constitution v2.4.0)', () => {
  it('accepts the bytes, and confirm + pipeline finish the journey', async () => {
    const user = await registerVerifiedUser(appUrl);
    const { materialId } = await presign(user.session, TEXT_MATERIAL_BYTES.byteLength);
    expect(materialId).toBeTruthy();

    const uploaded = await user.session.put(
      `/api/materials/${materialId}/upload`,
      TEXT_MATERIAL_BYTES,
    );
    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toMatchObject({ ok: true });

    const confirmed = await confirmMaterial(user.session, materialId!);
    expect(confirmed.status).toBe(202);

    await runPipeline({ materialId: materialId! });
    const status = await materialStatus(user.session, materialId!);
    expect((status.body as StatusView).status).toBe('ready');
  });

  it('answers a non-revealing 404 for another user\'s material', async () => {
    const owner = await registerVerifiedUser(appUrl);
    const stranger = await registerVerifiedUser(appUrl);
    const { materialId } = await presign(owner.session, TEXT_MATERIAL_BYTES.byteLength);

    const foreign = await stranger.session.put(
      `/api/materials/${materialId}/upload`,
      TEXT_MATERIAL_BYTES,
    );
    expect(foreign.status).toBe(404);
    expect((foreign.body as { code: string }).code).toBe('not_found');
  });

  it('rejects a second upload once the material left awaiting_upload', async () => {
    const user = await registerVerifiedUser(appUrl);
    const { materialId } = await presign(user.session, TEXT_MATERIAL_BYTES.byteLength);

    const first = await user.session.put(
      `/api/materials/${materialId}/upload`,
      TEXT_MATERIAL_BYTES,
    );
    expect(first.status).toBe(200);
    await confirmMaterial(user.session, materialId!);

    const second = await user.session.put(
      `/api/materials/${materialId}/upload`,
      TEXT_MATERIAL_BYTES,
    );
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe('conflict');
  });

  it('rejects byte sizes that differ from the declared size and keeps the attempt retryable', async () => {
    const user = await registerVerifiedUser(appUrl);
    const { materialId } = await presign(user.session, TEXT_MATERIAL_BYTES.byteLength);

    const wrong = await user.session.put(
      `/api/materials/${materialId}/upload`,
      Buffer.concat([TEXT_MATERIAL_BYTES, Buffer.from('trailing bytes\n', 'utf8')]),
    );
    expect(wrong.status).toBe(400);
    expect((wrong.body as { code: string }).code).toBe('validation_failed');

    // The record is untouched, so a correct retry still fits the same slot.
    let status = await materialStatus(user.session, materialId!);
    expect((status.body as StatusView).status).toBe('awaiting_upload');

    const retry = await user.session.put(
      `/api/materials/${materialId}/upload`,
      TEXT_MATERIAL_BYTES,
    );
    expect(retry.status).toBe(200);
    status = await materialStatus(user.session, materialId!);
    expect((status.body as StatusView).status).toBe('awaiting_upload');
  });

  it('rejects an empty body', async () => {
    const user = await registerVerifiedUser(appUrl);
    const { materialId } = await presign(user.session, TEXT_MATERIAL_BYTES.byteLength);

    const empty = await user.session.put(`/api/materials/${materialId}/upload`, Buffer.alloc(0));
    expect(empty.status).toBe(400);
  });

  it('rejects an upload past the expiry window', async () => {
    const user = await registerVerifiedUser(appUrl);
    const { materialId } = await presign(user.session, TEXT_MATERIAL_BYTES.byteLength);

    await Material.updateOne(
      { _id: materialId },
      { $set: { uploadExpiresAt: new Date(Date.now() - 1000) } },
    ).exec();

    const late = await user.session.put(
      `/api/materials/${materialId}/upload`,
      TEXT_MATERIAL_BYTES,
    );
    expect(late.status).toBe(409);
    expect((late.body as { message: string }).message).toContain('expired');
  });

  it('answers anonymous uploads with 401', async () => {
    const anonymous = new TestSession(appUrl);
    const response = await anonymous.put('/api/materials/507f1f77bcf86cd799439011/upload', Buffer.from('x'));
    expect(response.status).toBe(401);
  });

  it('cancels an attempt: the record leaves the quota and 404s afterwards', async () => {
    const user = await registerVerifiedUser(appUrl);
    const { materialId } = await presign(user.session, TEXT_MATERIAL_BYTES.byteLength);

    const before = await user.session.get('/api/me/usage');
    const usedBefore = (before.body as { materials: { used: number } }).materials.used;
    expect(usedBefore).toBe(1);

    const cancelled = await user.session.delete(`/api/materials/${materialId}`);
    expect(cancelled.status).toBe(204);

    const gone = await materialStatus(user.session, materialId!);
    expect(gone.status).toBe(404);

    const after = await user.session.get('/api/me/usage');
    expect((after.body as { materials: { used: number } }).materials.used).toBe(0);
  });
});

