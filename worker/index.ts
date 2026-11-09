import { Worker, type Job } from 'bullmq';
import { getRedis } from '@/lib/db/redis';
import { getLogger } from '@/lib/logging/logger';
import { runWithCorrelation } from '@/lib/logging/correlation';
import { connectDb, disconnectDb } from '@/lib/db/connection';
import { closeQueues } from '@/lib/jobs/queues';
import {
  ACCOUNT_DELETION_QUEUE,
  MATERIAL_QUEUE,
  parseJobPayload,
  type DeleteAccountJob,
  type GenerateLessonJob,
  type ParseMaterialJob,
  type ScanMaterialJob,
} from '@/lib/jobs/schemas';
import { workerConcurrency, withJobLimits } from './runtime/limits';
import { processDeleteAccount } from './processors/delete-account';
import { processScanMaterial } from './processors/scan-material';
import { processParseMaterial } from './processors/parse-material';
import { processGenerateLesson } from './processors/generate-lesson';

const logger = getLogger().child({ service: 'talas-worker' });

export async function runMaterialJob(payload: ScanMaterialJob | ParseMaterialJob | GenerateLessonJob): Promise<void> {
  await withJobLimits(payload.type, async () => {
    switch (payload.type) {
      case 'scan_material':
        await processScanMaterial(payload);
        return;
      case 'parse_material':
        await processParseMaterial(payload);
        return;
      case 'generate_lesson':
        await processGenerateLesson(payload);
        return;
    }
  });
}

async function handle(job: Job): Promise<void> {
  const payload = parseJobPayload(job.data);
  await runWithCorrelation({ correlationId: payload.correlationId, userId: payload.userId }, async () => {
    logger.info({ jobId: job.id, jobType: payload.type }, 'Worker job started');
    if (payload.type === 'delete_account') {
      await withJobLimits(payload.type, () => processDeleteAccount(payload as DeleteAccountJob));
    } else {
      await runMaterialJob(payload);
    }
    logger.info({ jobId: job.id, jobType: payload.type }, 'Worker job finished');
  });
}

/**
 * Persists a safe terminal failure for a material job once BullMQ has exhausted
 * its bounded automatic retries and the material is still in a transient state.
 */
async function finalizeExhaustedMaterialJob(job: Job): Promise<void> {
  const data = job.data as { type?: string; materialId?: string; userId?: string; correlationId?: string };
  if (!data || data.type === 'delete_account' || !data.materialId || !data.userId) return;

  const attemptsConfigured = job.opts?.attempts ?? 1;
  if (attemptsConfigured > 1 && job.attemptsMade < attemptsConfigured) return;

  const { Material } = await import('@/lib/db/models/material');
  const { ProcessingJob } = await import('@/lib/db/models/processing-job');
  const { failureMessage } = await import('@/lib/materials/failure-messages');

  const material = await Material.findOne({ _id: data.materialId, userId: data.userId }).exec();
  if (!material) return;
  const terminal = new Set(['ready', 'failed', 'quarantined', 'deleted']);
  if (terminal.has(material.status)) return;

  await Material.updateOne(
    { _id: data.materialId, userId: data.userId },
    { $set: { status: 'failed', failureCode: 'internal_error', failureMessage: failureMessage('internal_error') } },
  ).exec();
  await ProcessingJob.updateOne(
    { materialId: data.materialId, userId: data.userId },
    { $set: { status: 'failed', leaseUntil: null, lastErrorCode: 'internal_error', lastErrorMessage: failureMessage('internal_error') } },
  ).exec();
}

let workers: Worker[] = [];

export async function startWorker(): Promise<Worker[]> {
  await connectDb();
  const connection = getRedis();
  const concurrency = workerConcurrency();

  workers = [
    new Worker(MATERIAL_QUEUE, handle, { connection, concurrency }),
    new Worker(ACCOUNT_DELETION_QUEUE, handle, { connection, concurrency: 1 }),
  ];

  for (const worker of workers) {
    worker.on('failed', async (job, error) => {
      logger.error({ jobId: job?.id, jobType: job?.name, err: error }, 'Worker job failed');
      if (job) await finalizeExhaustedMaterialJob(job).catch(() => undefined);
    });
    worker.on('error', (error) => logger.error({ err: error }, 'Worker error'));
  }

  logger.info({ concurrency }, 'Worker started');
  return workers;
}

export async function stopWorker(): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
  await closeQueues().catch(() => undefined);
  await disconnectDb().catch(() => undefined);
  logger.info('Worker stopped');
}

async function main(): Promise<void> {
  await startWorker();
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down worker');
    await stopWorker();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (process.env.NODE_ENV !== 'test' && process.env.WORKER_DISABLE_AUTOSTART !== 'true') {
  main().catch((error: unknown) => {
    logger.error({ err: error }, 'Worker bootstrap failed');
    process.exit(1);
  });
}
