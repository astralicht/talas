import { Queue, type JobsOptions } from 'bullmq';
import { getRedis } from '@/lib/db/redis';
import {
  ACCOUNT_DELETION_QUEUE,
  MATERIAL_QUEUE,
  jobIdFor,
  type DeleteAccountJob,
  type MaterialJob,
} from './schemas';

const globalForQueues = globalThis as unknown as {
  __talasMaterialQueue?: Queue;
  __talasDeletionQueue?: Queue;
  __talasMemoryJobs?: MemoryJob[];
};

export interface MemoryJob {
  queue: string;
  name: string;
  payload: unknown;
  id: string;
}

const defaultJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: 500,
  removeOnFail: 500,
  backoff: { type: 'exponential', delay: 5_000 },
};

function memoryQueueMode(): boolean {
  return (
    process.env.JOB_QUEUE_MEMORY === 'true' ||
    (process.env.NODE_ENV === 'test' && process.env.JOB_QUEUE_MEMORY !== 'false')
  );
}

function memoryJobs(): MemoryJob[] {
  if (!globalForQueues.__talasMemoryJobs) globalForQueues.__talasMemoryJobs = [];
  return globalForQueues.__talasMemoryJobs;
}

export function getMaterialQueue(): Queue {
  if (!globalForQueues.__talasMaterialQueue) {
    globalForQueues.__talasMaterialQueue = new Queue(MATERIAL_QUEUE, {
      connection: getRedis(),
      defaultJobOptions,
    });
  }
  return globalForQueues.__talasMaterialQueue;
}

export function getAccountDeletionQueue(): Queue {
  if (!globalForQueues.__talasDeletionQueue) {
    globalForQueues.__talasDeletionQueue = new Queue(ACCOUNT_DELETION_QUEUE, {
      connection: getRedis(),
      defaultJobOptions,
    });
  }
  return globalForQueues.__talasDeletionQueue;
}

export async function enqueueMaterialJob(payload: MaterialJob): Promise<string> {
  const id = jobIdFor(payload.type, payload.materialId);
  if (memoryQueueMode()) {
    memoryJobs().push({ queue: MATERIAL_QUEUE, name: payload.type, payload, id });
    return id;
  }
  const queue = getMaterialQueue();
  const job = await queue.add(payload.type, payload, {
    jobId: id,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  });
  return job.id ?? id;
}

export async function enqueueAccountDeletionJob(payload: DeleteAccountJob): Promise<string> {
  const id = `delete-account_${payload.userId}`;
  if (memoryQueueMode()) {
    memoryJobs().push({ queue: ACCOUNT_DELETION_QUEUE, name: payload.type, payload, id });
    return id;
  }
  const queue = getAccountDeletionQueue();
  const job = await queue.add(payload.type, payload, {
    jobId: id,
    removeOnComplete: false,
    removeOnFail: false,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
  });
  return job.id ?? id;
}

export function listMemoryJobsForTests(queue?: string): MemoryJob[] {
  const jobs = memoryJobs();
  return queue ? jobs.filter((job) => job.queue === queue) : [...jobs];
}

/** Drains and removes queued memory jobs so each payload is processed exactly once. */
export function takeMemoryJobsForTests(queue?: string): MemoryJob[] {
  const remaining = memoryJobs().filter((job) => !queue || job.queue === queue);
  globalForQueues.__talasMemoryJobs = queue
    ? memoryJobs().filter((job) => job.queue !== queue)
    : [];
  return remaining;
}

export function resetMemoryJobsForTests(): void {
  globalForQueues.__talasMemoryJobs = [];
}

export async function closeQueues(): Promise<void> {
  await globalForQueues.__talasMaterialQueue?.close().catch(() => undefined);
  await globalForQueues.__talasDeletionQueue?.close().catch(() => undefined);
  delete globalForQueues.__talasMaterialQueue;
  delete globalForQueues.__talasDeletionQueue;
}
