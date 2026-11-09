import { getEnv } from '@/lib/env';

export const MEMORY_CEILING_BYTES = 1_024 * 1_024 * 1_024;

export class JobTimeoutError extends Error {
  constructor(public readonly jobName: string, public readonly timeoutMs: number) {
    super(`Job ${jobName} exceeded ${timeoutMs}ms`);
    this.name = 'JobTimeoutError';
  }
}

export class JobMemoryError extends Error {
  constructor(public readonly bytes: number) {
    super(`Worker memory ceiling exceeded: ${bytes} bytes`);
    this.name = 'JobMemoryError';
  }
}

export function assertWithinMemoryBudget(ceiling = MEMORY_CEILING_BYTES): void {
  const usage = process.memoryUsage().rss;
  if (usage > ceiling) throw new JobMemoryError(usage);
}

export async function withJobLimits<T>(
  jobName: string,
  fn: () => Promise<T>,
  timeoutMs = getEnv().MAX_JOB_MS,
): Promise<T> {
  assertWithinMemoryBudget();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new JobTimeoutError(jobName, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function workerConcurrency(): number {
  return getEnv().WORKER_CONCURRENCY;
}

export function maxJobMs(): number {
  return getEnv().MAX_JOB_MS;
}
