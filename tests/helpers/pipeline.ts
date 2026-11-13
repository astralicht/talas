import {
  listMemoryJobsForTests,
  resetMemoryJobsForTests,
  takeMemoryJobsForTests,
} from '@/lib/jobs/queues';
import { resetFakeObjectStore, getFakeObjectStore } from '@/lib/storage/s3';
import { processScanMaterial } from '@/worker/processors/scan-material';
import { processParseMaterial } from '@/worker/processors/parse-material';
import {
  processGenerateLesson,
  processGenerateLessonRequest,
} from '@/worker/processors/generate-lesson';
import type {
  DeleteAccountJob,
  GenerateLessonJob,
  GenerateLessonRequestJob,
  MaterialJob,
  ParseMaterialJob,
  ScanMaterialJob,
} from '@/lib/jobs/schemas';

/** Clears the memory queue, fake object store, and any pending outbox state. */
export function resetPipelineState(): void {
  resetMemoryJobsForTests();
  resetFakeObjectStore();
}

/** Drains and consumes material jobs so each payload runs exactly once. */
export function drainMaterialJobs(): MaterialJob[] {
  return takeMemoryJobsForTests().map((job) => job.payload) as MaterialJob[];
}

/** Drains queued account-cascade jobs, keeping them in queue order. */
export function drainAccountDeletionJobs(): DeleteAccountJob[] {
  return takeMemoryJobsForTests('account-deletion').map(
    (job) => job.payload,
  ) as DeleteAccountJob[];
}

/** Non-destructive peek at material jobs for one material. */
export function materialJobsFor(materialId: string): MaterialJob[] {
  return listMemoryJobsForTests()
    .filter((job) => (job.payload as { materialId?: string }).materialId === materialId)
    .map((job) => job.payload) as MaterialJob[];
}

async function runProcessor(
  job: ScanMaterialJob | ParseMaterialJob | GenerateLessonJob,
): Promise<void> {
  switch (job.type) {
    case 'scan_material':
      await processScanMaterial(job);
      break;
    case 'parse_material':
      await processParseMaterial(job);
      break;
    case 'generate_lesson':
      await processGenerateLesson(job);
      break;
  }
}

/**
 * Runs queued material jobs to termination — exactly what the worker would — by
 * dispatching payloads to the real processors. Returns the payloads seen.
 *
 * Since specs/005 the automatic pipeline is scan → parse → ready; lesson
 * generation is explicit-only, so suites that need a lesson call
 * `generateLessonForMaterial` after `runPipeline`.
 */
export async function runPipeline(
  options: { limit?: number; materialId?: string } = {},
): Promise<MaterialJob[]> {
  const limit = options.limit ?? 24;
  const processed: MaterialJob[] = [];
  for (let index = 0; index < limit; index += 1) {
    const pending = drainMaterialJobs().filter((job) => {
      if (options.materialId) return (job as { materialId?: string }).materialId === options.materialId;
      return true;
    });
    for (const job of pending as (ScanMaterialJob | ParseMaterialJob | GenerateLessonJob)[]) {
      processed.push(job);
      await runProcessor(job);
    }
    if (pending.length === 0) break;
  }
  return processed;
}

/**
 * Drives the dormant single-material generate stage for one material, the way
 * an explicit lesson-generation request would (the request API itself arrives
 * with specs/005 Step 4). Re-arms the processing job first so the stage claim
 * succeeds even when the automatic pipeline already finished at `ready`.
 */
export async function generateLessonForMaterial(
  materialId: string,
  userId: string,
  correlationId = 'test-explicit-generate',
): Promise<void> {
  const { ProcessingJobRepository } = await import('@/lib/db/repositories/processing-job-repository');
  await new ProcessingJobRepository(userId).markQueuedForRetry(materialId);
  await processGenerateLesson({
    type: 'generate_lesson',
    materialId,
    userId,
    correlationId,
  } as GenerateLessonJob);
}

/**
 * Drains the lesson-generation queue and runs the explicit request processor
 * for one request id — what the dedicated worker would do (specs/005).
 * Returns the job payload that was executed.
 */
export async function runGenerationRequest(
  requestId: string,
  userId: string,
): Promise<GenerateLessonRequestJob> {
  const job = takeMemoryJobsForTests('lesson-generation').find(
    (entry) => (entry.payload as { requestId?: string }).requestId === requestId,
  );
  if (!job) throw new Error(`No lesson-generation job queued for request ${requestId}`);
  const payload = job.payload as GenerateLessonRequestJob;
  await processGenerateLessonRequest(payload);
  void userId;
  return payload;
}

export const fakeUpload = (storageKey: string, bytes: Buffer, contentType: string) => {
  getFakeObjectStore().objects.set(storageKey, { bytes, contentType });
};
