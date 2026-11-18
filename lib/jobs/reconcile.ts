import type { Queue } from 'bullmq';
import type { Types } from 'mongoose';
import { getLogger } from '@/lib/logging/logger';
import { newCorrelationId } from '@/lib/logging/correlation';
import { Material } from '@/lib/db/models/material';
import { ProcessingJob } from '@/lib/db/models/processing-job';
import { LessonGenerationRequest } from '@/lib/db/models/lesson-generation-request';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { ProcessingJobRepository } from '@/lib/db/repositories/processing-job-repository';
import {
  enqueueLessonGenerationJob,
  enqueueMaterialJob,
  getLessonGenerationQueue,
  getMaterialQueue,
  isMemoryQueueMode,
} from './queues';
import { generateLessonJobIdFor, jobIdFor } from './schemas';

const logger = getLogger().child({ service: 'job-reconcile' });

/**
 * Reconciliation sweep for jobs that the durable state expects to be running
 * but that no queue holds any more. The queue transport (BullMQ on Redis) is
 * not durable across a Redis restart, so a confirmed upload whose scan job was
 * enqueued right before the restart would otherwise sit in `uploaded` forever:
 * the database says `queued`, Redis has nothing, and nothing ever re-enqueues.
 *
 * Two material cases are repaired, both idempotent thanks to BullMQ's jobId
 * dedupe (`scan_material_{id}`) and the claim gate's expired-lease tolerance:
 *
 * 1. queued but never started (`attempts: 0`, stale `updatedAt`) — the job was
 *    lost or the backlog is wedged; it is re-enqueued.
 * 2. claimed but the worker died mid-stage (lease expired) — the job row and
 *    the material are handed back to the scan stage (mirroring the user-retry
 *    reset) and the scan is re-enqueued. Rows whose material is `ready` belong
 *    to the generation stage and are owned by the request lease, not this sweep.
 *
 * Lesson-generation requests get the same treatment through their own lease
 * (10 minutes vs the 2-minute job timeout, so an expired lease means the
 * worker genuinely died).
 */
const STALE_AFTER_MS = 60_000;
const TERMINAL_MATERIAL_STATUSES = new Set(['ready', 'failed', 'quarantined', 'deleted']);

export interface ReconcileResult {
  rescheduledMaterials: number;
  rescheduledRequests: number;
}

/**
 * Removes a finished BullMQ copy that would dedupe-block the re-add. A
 * waiting/active copy is left alone: re-adding with the same jobId is ignored,
 * which is exactly the desired idempotence for a healthy backlog.
 *
 * Skipped entirely in memory mode (no BullMQ dedupe there). The lookup is
 * time-bounded: an unreachable Redis must degrade to "skip cleanup" rather
 * than hang the sweep — `maxRetriesPerRequest: null` would otherwise wait
 * forever on the first command.
 */
const PROBE_TIMEOUT_MS = 2_000;

async function clearBlockingCopy(queue: Queue, jobId: string): Promise<void> {
  if (isMemoryQueueMode()) return;
  try {
    const existing = await Promise.race([
      queue.getJob(jobId),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), PROBE_TIMEOUT_MS).unref();
      }),
    ]);
    if (!existing) return;
    const state = await Promise.race([
      existing.getState(),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('unknown'), PROBE_TIMEOUT_MS).unref();
      }),
    ]);
    if (state === 'completed' || state === 'failed') await existing.remove();
  } catch {
    // Queue unreachable: the re-add below surfaces the real error.
  }
}

async function rescheduleMaterialScan(materialId: string, userId: string): Promise<boolean> {
  const material = await Material.findOne({ _id: materialId, userId })
    .select('status')
    .lean<{ status: string } | null>()
    .exec();
  if (!material || TERMINAL_MATERIAL_STATUSES.has(material.status)) return false;

  if (material.status !== 'uploaded') {
    // Mid-pipeline death: hand the job row and the material back to the scan
    // stage so the re-enqueued job can claim a consistent state. The
    // confirm-time detectedMime is kept: it is verified magic-byte data the
    // parse stage needs.
    const jobs = new ProcessingJobRepository(userId);
    await jobs.markQueuedForRetry(materialId);
    const materials = new MaterialRepository(userId);
    const reset = await materials.transition(
      materialId,
      ['scanning', 'queued', 'processing'],
      'uploaded',
    );
    if (!reset) return false;
  }

  await clearBlockingCopy(getMaterialQueue(), jobIdFor('scan_material', materialId));
  await enqueueMaterialJob({
    type: 'scan_material',
    materialId,
    userId,
    correlationId: newCorrelationId(),
  });
  return true;
}

async function rescheduleGenerationRequest(request: {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  materialIds: Types.ObjectId[];
  title: string;
}): Promise<boolean> {
  await clearBlockingCopy(
    getLessonGenerationQueue(),
    generateLessonJobIdFor(request._id.toHexString()),
  );
  await enqueueLessonGenerationJob({
    type: 'generate_lesson_request',
    requestId: request._id.toHexString(),
    materialIds: request.materialIds.map((id) => id.toHexString()),
    title: request.title,
    userId: request.userId.toHexString(),
    correlationId: newCorrelationId(),
  });
  return true;
}

export async function reconcileStaleJobs(now = new Date()): Promise<ReconcileResult> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const result: ReconcileResult = { rescheduledMaterials: 0, rescheduledRequests: 0 };

  const staleRows = await ProcessingJob.find({
    $or: [
      { status: 'queued', attempts: 0, updatedAt: { $lt: cutoff } },
      { status: 'processing', leaseUntil: { $lte: now } },
    ],
  })
    .select('materialId userId')
    .lean<{ materialId: Types.ObjectId; userId: Types.ObjectId }[]>()
    .exec();

  for (const row of staleRows) {
    try {
      const rescheduled = await rescheduleMaterialScan(
        row.materialId.toHexString(),
        row.userId.toHexString(),
      );
      if (rescheduled) result.rescheduledMaterials += 1;
    } catch (error) {
      logger.warn({ err: error, materialId: row.materialId }, 'Material reconciliation failed');
    }
  }

  const staleRequests = await LessonGenerationRequest.find({
    $or: [
      { status: 'queued', updatedAt: { $lt: cutoff } },
      { status: 'processing', leaseUntil: { $lte: now } },
    ],
  })
    .select('_id userId materialIds title')
    .lean<{ _id: Types.ObjectId; userId: Types.ObjectId; materialIds: Types.ObjectId[]; title: string }[]>()
    .exec();

  for (const request of staleRequests) {
    try {
      await rescheduleGenerationRequest(request);
      result.rescheduledRequests += 1;
    } catch (error) {
      logger.warn({ err: error, requestId: request._id }, 'Request reconciliation failed');
    }
  }

  return result;
}
