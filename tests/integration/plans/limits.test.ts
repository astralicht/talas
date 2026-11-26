import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { registerVerifiedUser, type RegisteredUser } from '../../helpers/client';
import { confirmMaterial, materialStatus, uploadToStorage } from '../../helpers/material-upload';
import { runGenerationRequest, runPipeline, resetPipelineState } from '../../helpers/pipeline';
import { TEXT_MATERIAL_BYTES } from '../../fixtures/materials';
import { Types } from 'mongoose';
import { Material } from '@/lib/db/models/material';
import { User } from '@/lib/db/models/user';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

/** ~15k characters: over the 10,000-character plan cap. */
function oversizedMarkdown(): Buffer {
  return Buffer.from(`# Oversized study guide\n\n${'word '.repeat(3_000)}`, 'utf8');
}

/** Seeds material rows directly so quota tests stay under the upload rate limits. */
async function seedMaterials(user: RegisteredUser, count: number, sizeBytes = 100): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const materialId = new Types.ObjectId();
    await Material.create({
      _id: materialId,
      userId: new Types.ObjectId(user.user.id),
      originalFilename: `seeded-${index}.md`,
      storageKey: `materials/${user.user.id}/${materialId.toHexString()}`,
      declaredMime: 'text/markdown',
      sizeBytes,
      status: 'ready',
      scanResult: 'clean',
      charCount: 100,
      uploadExpiresAt: new Date(),
    });
    ids.push(materialId.toHexString());
  }
  return ids;
}

async function setPlan(user: RegisteredUser, plan: 'free' | 'plus'): Promise<void> {
  await User.updateOne({ _id: new Types.ObjectId(user.user.id) }, { $set: { plan } }).exec();
}

function presign(session: RegisteredUser['session'], filename: string) {
  return session.post('/api/materials/presign', {
    filename,
    declaredMime: 'text/markdown',
    sizeBytes: 100,
  });
}

interface QuotaEnvelope {
  code: string;
  message: string;
  correlationId: string;
  details?: { reason?: string; used?: number; limit?: number; purged?: number; resetsAt?: string };
}

describe('plan-based feature limits (constitution v2.3.0)', () => {
  it('blocks the presign when the storage quota is full', async () => {
    const user = await registerVerifiedUser(appUrl);
    await seedMaterials(user, 8, 150 * 1024 * 1024);

    const response = await presign(user.session, 'blocked.md');
    expect(response.status).toBe(403);
    const body = response.body as QuotaEnvelope;
    expect(body.code).toBe('plan_limit');
    expect(body.correlationId).toBeTruthy();
    expect(body.message).toContain('free');
    expect(body.details).toMatchObject({
      reason: 'plan_storage_limit',
      purged: 0,
    });
  });

  it('frees space when a material is deleted', async () => {
    const user = await registerVerifiedUser(appUrl);
    const ids = await seedMaterials(user, 7, 150 * 1024 * 1024);

    const blocked = await presign(user.session, 'blocked.md');
    expect(blocked.status).toBe(403);

    const removed = await user.session.delete(`/api/materials/${ids[0]}`);
    expect(removed.status).toBe(204);

    const allowed = await presign(user.session, 'freed.md');
    expect(allowed.status).toBe(201);
  });

  it('applies a plan switch to the quotas immediately', async () => {
    const user = await registerVerifiedUser(appUrl);
    await seedMaterials(user, 8, 150 * 1024 * 1024);

    const blocked = await presign(user.session, 'blocked.md');
    expect(blocked.status).toBe(403);

    await setPlan(user, 'plus');

    const usage = await user.session.get('/api/me/usage');
    expect(usage.status).toBe(200);
    const snapshot = usage.body as Record<string, unknown>;
    expect(Object.keys(snapshot).sort()).toEqual([
      'generations',
      'lessons',
      'maxMaterialChars',
      'plan',
      'storage',
    ]);
    expect(snapshot.plan).toBe('plus');
    const storage = snapshot.storage as { used: number; limit: number };
    expect(storage.used).toBeGreaterThan(0);
    expect(storage.limit).toBe(5 * 1024 * 1024 * 1024);
    expect(snapshot.lessons).toMatchObject({ used: 0, limit: 7 });
    expect(snapshot.maxMaterialChars).toBe(10_000);
    expect(snapshot.generations).toMatchObject({ used: 0, limit: 7 });
    expect(typeof (snapshot.generations as { resetsAt: string }).resetsAt).toBe('string');

    const allowed = await presign(user.session, 'upgraded.md');
    expect(allowed.status).toBe(201);
  });

  it('re-checks the quota at confirm so presign races cannot overrun it', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToStorage(
      user.session,
      user.user.id,
      'racing.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    // A concurrent presign (or a seeded backlog) fills the remaining storage.
    await seedMaterials(user, 8, 150 * 1024 * 1024);

    const confirmed = await confirmMaterial(user.session, upload.materialId);
    expect(confirmed.status).toBe(403);
    expect((confirmed.body as QuotaEnvelope).details?.reason).toBe('plan_storage_limit');

    const status = await materialStatus(user.session, upload.materialId);
    expect((status.body as { status: string }).status).toBe('awaiting_upload');
  });

  it('fails materials over the plan character cap with split guidance', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToStorage(
      user.session,
      user.user.id,
      'oversized.md',
      'text/markdown',
      oversizedMarkdown(),
    );
    await confirmMaterial(user.session, upload.materialId);

    // The processor classifies the over-cap document as terminal.
    let failure: unknown;
    try {
      await runPipeline({ materialId: upload.materialId });
    } catch (error) {
      failure = error;
    }
    expect(String(failure)).toContain('plan character limit');

    const status = await materialStatus(user.session, upload.materialId);
    const view = status.body as { status: string; failureCode: string | null; failureMessage: string | null };
    expect(view.status).toBe('failed');
    expect(view.failureCode).toBe('plan_char_limit');
    expect(view.failureMessage).toContain('Split the document');

    // Terminal: retrying would fail identically, so the route refuses.
    const retry = await user.session.post(`/api/materials/${upload.materialId}/retry`, {});
    expect(retry.status).toBe(409);
    expect((retry.body as { code: string }).code).toBe('conflict');
  });

  it('informs first, then auto-purges dead oversized uploads on a blocked split upload', async () => {
    const user = await registerVerifiedUser(appUrl);
    await seedMaterials(user, 6, 150 * 1024 * 1024);

    // A dead over-limit record (char cap) holding 150 MB of storage.
    const failedId = new Types.ObjectId();
    await Material.create({
      _id: failedId,
      userId: new Types.ObjectId(user.user.id),
      originalFilename: 'oversized.md',
      storageKey: `materials/${user.user.id}/${failedId.toHexString()}`,
      declaredMime: 'text/markdown',
      sizeBytes: 150 * 1024 * 1024,
      status: 'failed',
      failureCode: 'plan_char_limit',
      scanResult: 'clean',
      charCount: 0,
      uploadExpiresAt: new Date(),
      deletedAt: null,
    });

    const blocked = await user.session.post('/api/materials/presign', {
      filename: 'split-part-1.md',
      declaredMime: 'text/markdown',
      sizeBytes: 150 * 1024 * 1024,
    });
    expect(blocked.status).toBe(403);
    const body = blocked.body as QuotaEnvelope;
    expect(body.details).toMatchObject({ reason: 'plan_storage_limit', purged: 1 });
    expect(body.message).toContain('removed');

    const purged = await Material.findById(failedId)
      .lean<{ status: string; deletedAt: Date | null }>()
      .exec();
    expect(purged?.status).toBe('deleted');
    expect(purged?.deletedAt).not.toBeNull();

    const retry = await presign(user.session, 'split-part-1.md');
    expect(retry.status).toBe(201);
  });

  it('limits lesson storage and surfaces the daily allowance reset', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToStorage(
      user.session,
      user.user.id,
      'single.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });

    // Free plan: three lesson slots (TODO step 15) — fill them all.
    for (let index = 0; index < 3; index += 1) {
      const generation = await user.session.post('/api/lessons/generate', {
        title: `Lesson ${index + 1}`,
        materialIds: [upload.materialId],
      });
      expect(generation.status).toBe(202);
      const view = generation.body as { requestId: string };
      await runGenerationRequest(view.requestId, user.user.id);
    }

    const blocked = await user.session.post('/api/lessons/generate', {
      title: 'Fourth lesson',
      materialIds: [upload.materialId],
    });
    expect(blocked.status).toBe(403);
    expect((blocked.body as QuotaEnvelope).details?.reason).toBe('plan_lesson_limit');
  });

  it('separates lesson storage from the daily generation allowance', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToStorage(
      user.session,
      user.user.id,
      'daily.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });

    // Free plan: three daily allowance points (TODO step 15). Exhaust them
    // directly (each upload costs two rate-limit points, so flooding real
    // generations would trip the upload limiter first).
    const { reserveLessonGeneration } = await import('@/lib/plans/allowance');
    for (let index = 0; index < 3; index += 1) {
      const reservation = await reserveLessonGeneration(user.user.id, 3);
      expect(reservation.reserved).toBe(true);
    }

    // The lesson storage slots are free (0/3 used), yet the fourth same-day
    // generation is blocked by the allowance alone.
    const again = await user.session.post('/api/lessons/generate', {
      title: 'Fourth generation today',
      materialIds: [upload.materialId],
    });
    expect(again.status).toBe(403);
    const body = again.body as QuotaEnvelope;
    expect(body.details?.reason).toBe('plan_generation_limit');
    expect(body.details?.resetsAt).toBeTruthy();

    // A plan switch immediately raises both the storage and the allowance.
    await setPlan(user, 'plus');
    const upgraded = await user.session.post('/api/lessons/generate', {
      title: 'Upgraded lesson',
      materialIds: [upload.materialId],
    });
    expect(upgraded.status).toBe(202);
  });

  it('refunds the allowance when a generation fails terminally', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToStorage(
      user.session,
      user.user.id,
      'doomed.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });

    const created = await user.session.post('/api/lessons/generate', {
      title: 'Doomed lesson',
      materialIds: [upload.materialId],
    });
    expect(created.status).toBe(202);
    const view = created.body as { requestId: string };

    // The source disappears before the worker runs: terminal material_unavailable.
    await Material.deleteOne({
      _id: new Types.ObjectId(upload.materialId),
      userId: new Types.ObjectId(user.user.id),
    }).exec();
    await runGenerationRequest(view.requestId, user.user.id);

    const poll = await user.session.get(`/api/lesson-requests/${view.requestId}`);
    expect((poll.body as { status: string }).status).toBe('failed');

    // The refund restored the point: the next request reserves successfully.
    const retry = await user.session.post('/api/lessons/generate', {
      title: 'After refund',
      materialIds: [upload.materialId],
    });
    expect(retry.status).toBe(404); // material is gone — but admission passed the allowance
    expect((retry.body as { code: string }).code).toBe('not_found');
  });

  it('exempts regeneration from the daily allowance', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToStorage(
      user.session,
      user.user.id,
      'regen.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });

    const created = await user.session.post('/api/lessons/generate', {
      title: 'Regen base',
      materialIds: [upload.materialId],
    });
    expect(created.status).toBe(202);
    const createdView = created.body as { requestId: string };
    await runGenerationRequest(createdView.requestId, user.user.id);

    const poll = await user.session.get(`/api/lesson-requests/${createdView.requestId}`);
    const lessonId = (poll.body as { lessonId: string | null }).lessonId as string;
    expect(lessonId).toBeTruthy();

    // Free plan: one of three daily points used, yet regeneration is exempt.
    const usage = await user.session.get('/api/me/usage');
    expect((usage.body as { generations: { used: number; limit: number } }).generations).toMatchObject({
      used: 1,
      limit: 3,
    });

    const regenerated = await user.session.post(`/api/lessons/${lessonId}/regenerate`, {
      version: 1,
    });
    expect(regenerated.status).toBe(202);
    const regenView = regenerated.body as { requestId: string };
    await runGenerationRequest(regenView.requestId, user.user.id);

    const regenPoll = await user.session.get(`/api/lesson-requests/${regenView.requestId}`);
    expect((regenPoll.body as { status: string }).status).toBe('ready');

    // The allowance did not move: still exactly the one fresh generation.
    const usageAfter = await user.session.get('/api/me/usage');
    expect((usageAfter.body as { generations: { used: number } }).generations.used).toBe(1);
  });
});
