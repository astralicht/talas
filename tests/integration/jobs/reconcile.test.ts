import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { resetPipelineState, runPipeline, fakeUpload } from '../../helpers/pipeline';
import { reconcileStaleJobs } from '@/lib/jobs/reconcile';
import { listMemoryJobsForTests } from '@/lib/jobs/queues';
import { MATERIAL_QUEUE, LESSON_GENERATION_QUEUE, generateLessonJobIdFor } from '@/lib/jobs/schemas';
import { Material } from '@/lib/db/models/material';
import { ProcessingJob } from '@/lib/db/models/processing-job';
import { LessonGenerationRequest } from '@/lib/db/models/lesson-generation-request';
import { TEXT_MATERIAL_BYTES } from '../../fixtures/materials';

let appUrl = '';

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

// The app server bootstraps the shared mongoose connection; direct model
// access in this file rides on it.
void appUrl;

const TEXT = TEXT_MATERIAL_BYTES;

/** Seeds a material row directly; no upload-rate budget is consumed. */
async function seedMaterial(userId: Types.ObjectId, status: string): Promise<{ id: string; storageKey: string }> {
  const materialId = new Types.ObjectId();
  const storageKey = `materials/${userId.toHexString()}/${materialId.toHexString()}`;
  await Material.create({
    _id: materialId,
    userId,
    originalFilename: 'reconcile.md',
    storageKey,
    declaredMime: 'text/markdown',
    detectedMime: 'text/markdown',
    sizeBytes: TEXT.byteLength,
    status,
    scanResult: 'clean',
    charCount: TEXT.length,
    uploadExpiresAt: new Date(),
  });
  return { id: materialId.toHexString(), storageKey };
}

function tenMinutesAgo(): Date {
  return new Date(Date.now() - 10 * 60 * 1000);
}

describe('stale job reconciliation (Redis-loss recovery)', () => {
  it('re-enqueues a queued-never-started scan job and finishes the pipeline', async () => {
    const userId = new Types.ObjectId();
    const material = await seedMaterial(userId, 'uploaded');
    fakeUpload(material.storageKey, TEXT, 'text/markdown');
    await ProcessingJob.create({
      userId,
      materialId: new Types.ObjectId(material.id),
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
    });
    // Backdate through the NATIVE driver: Mongoose's timestamps plugin
    // overwrites an explicit updatedAt in model-level updates, which would
    // defeat the staleness window under test.
    await ProcessingJob.collection.updateOne(
      { materialId: new Types.ObjectId(material.id) },
      { $set: { updatedAt: tenMinutesAgo() } },
    );

    const result = await reconcileStaleJobs();
    expect(result.rescheduledMaterials).toBe(1);

    const enqueued = listMemoryJobsForTests(MATERIAL_QUEUE);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.name).toBe('scan_material');

    await runPipeline({ materialId: material.id });

    const settled = await Material.findById(material.id).lean<{ status: string }>().exec();
    expect(settled?.status).toBe('ready');
  });

  it('recovers a material whose worker died mid-stage (expired lease)', async () => {
    const userId = new Types.ObjectId();
    const material = await seedMaterial(userId, 'scanning');
    fakeUpload(material.storageKey, TEXT, 'text/markdown');
    await ProcessingJob.create({
      userId,
      materialId: new Types.ObjectId(material.id),
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      leaseUntil: tenMinutesAgo(),
    });

    const result = await reconcileStaleJobs();
    expect(result.rescheduledMaterials).toBe(1);

    // Both the row and the material are handed back to the scan stage.
    const jobRow = await ProcessingJob.findOne({
      materialId: new Types.ObjectId(material.id),
    })
      .lean<{ status: string; leaseUntil: Date | null }>()
      .exec();
    expect(jobRow?.status).toBe('queued');
    expect(jobRow?.leaseUntil).toBeNull();
    const materialRow = await Material.findById(material.id).lean<{ status: string }>().exec();
    expect(materialRow?.status).toBe('uploaded');

    await runPipeline({ materialId: material.id });
    const settled = await Material.findById(material.id).lean<{ status: string }>().exec();
    expect(settled?.status).toBe('ready');
  });

  it('leaves a healthy fast path untouched', async () => {
    const userId = new Types.ObjectId();
    const material = await seedMaterial(userId, 'uploaded');
    await ProcessingJob.create({
      userId,
      materialId: new Types.ObjectId(material.id),
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
    });

    const result = await reconcileStaleJobs();
    expect(result.rescheduledMaterials).toBe(0);
    expect(listMemoryJobsForTests(MATERIAL_QUEUE)).toHaveLength(0);
  });

  it('skips expired generation-stage rows whose material is terminal', async () => {
    const userId = new Types.ObjectId();
    const material = await seedMaterial(userId, 'ready');
    await ProcessingJob.create({
      userId,
      materialId: new Types.ObjectId(material.id),
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      leaseUntil: tenMinutesAgo(),
    });

    const result = await reconcileStaleJobs();
    expect(result.rescheduledMaterials).toBe(0);
    expect(listMemoryJobsForTests(MATERIAL_QUEUE)).toHaveLength(0);
  });

  it('re-enqueues a queued lesson-generation request whose job was lost', async () => {
    const userId = new Types.ObjectId();
    const sourceId = new Types.ObjectId();
    const request = await LessonGenerationRequest.create({
      userId,
      title: 'Reconciled lesson',
      materialIds: [sourceId],
      status: 'queued',
    });
    await LessonGenerationRequest.collection.updateOne(
      { _id: request._id },
      { $set: { updatedAt: tenMinutesAgo() } },
    );

    const result = await reconcileStaleJobs();
    expect(result.rescheduledRequests).toBe(1);

    const enqueued = listMemoryJobsForTests(LESSON_GENERATION_QUEUE);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.id).toBe(generateLessonJobIdFor(request._id.toHexString()));
    const payload = enqueued[0]?.payload as { requestId: string; title: string; materialIds: string[] };
    expect(payload.requestId).toBe(request._id.toHexString());
    expect(payload.title).toBe('Reconciled lesson');
    expect(payload.materialIds).toEqual([sourceId.toHexString()]);
  });
});
