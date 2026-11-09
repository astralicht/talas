import { Types, type FilterQuery } from 'mongoose';
import {
  ProcessingJob,
  MAX_PROCESSING_ATTEMPTS,
  type IProcessingJob,
} from '@/lib/db/models/processing-job';
import { TenantRepository } from './tenant-repository';

const LEASE_MS = 5 * 60 * 1000;

export class ProcessingJobRepository extends TenantRepository<IProcessingJob> {
  constructor(userId: string | Types.ObjectId) {
    super(ProcessingJob, userId);
  }

  /**
   * Material processing has exactly one job per material. Creating is idempotent:
   * an existing record for the material is left intact.
   */
  async ensureForMaterial(materialId: string | Types.ObjectId) {
    const id = new Types.ObjectId(materialId);
    const existing = await this.findOne({ materialId: id });
    if (existing) return existing;

    try {
      const [job] = await ProcessingJob.create([
        {
          userId: this.tenantId,
          materialId: id,
          status: 'queued',
          attempts: 0,
          maxAttempts: MAX_PROCESSING_ATTEMPTS,
        },
      ]);
      if (!job) throw new Error('Processing job could not be created');
      return job;
    } catch (error) {
      const duplicate =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: unknown }).code === 11000;
      if (!duplicate) throw error;
      const raced = await this.findOne({ materialId: id });
      if (!raced) throw error;
      return raced;
    }
  }

  async findForMaterial(materialId: string | Types.ObjectId) {
    return this.findOne({ materialId: new Types.ObjectId(materialId) });
  }

  /**
   * Atomically claims a stage of work for the material. A claim succeeds when the
   * job is freshly queued, or when a prior claim's lease has expired (a worker
   * died mid-stage). Bumps the attempt counter and stamps the lease.
   */
  async claimForStage(materialId: string | Types.ObjectId) {
    const now = new Date();
    return this.model
      .findOneAndUpdate(
        this.scope({
          materialId: new Types.ObjectId(materialId),
          $or: [
            { status: 'queued' },
            { status: 'processing', leaseUntil: { $lte: now } },
          ],
        } as FilterQuery<IProcessingJob>),
        {
          $set: {
            status: 'processing',
            leaseUntil: new Date(now.getTime() + LEASE_MS),
            startedAt: now,
          },
          $inc: { attempts: 1 },
        },
        { new: true },
      )
      .exec();
  }

  /** Returns the job to the queue so the next pipeline stage can claim it. */
  async markQueued(materialId: string | Types.ObjectId) {
    return this.model
      .findOneAndUpdate(
        this.scope({ materialId: new Types.ObjectId(materialId) } as FilterQuery<IProcessingJob>),
        { $set: { status: 'queued', leaseUntil: null } },
        { new: true },
      )
      .exec();
  }

  async markReady(materialId: string | Types.ObjectId) {
    return this.model
      .findOneAndUpdate(
        this.scope({ materialId: new Types.ObjectId(materialId) } as FilterQuery<IProcessingJob>),
        { $set: { status: 'ready', completedAt: new Date(), leaseUntil: null } },
        { new: true },
      )
      .exec();
  }

  async markFailed(
    materialId: string | Types.ObjectId,
    errorCode: string | null,
    errorMessage: string | null,
  ) {
    return this.model
      .findOneAndUpdate(
        this.scope({ materialId: new Types.ObjectId(materialId) } as FilterQuery<IProcessingJob>),
        {
          $set: {
            status: 'failed',
            leaseUntil: null,
            lastErrorCode: errorCode,
            lastErrorMessage: errorMessage,
          },
        },
        { new: true },
      )
      .exec();
  }

  /** Worker-side claim that ignores the tenant boundary; the materialId is trusted input. */
  async findForWorker(materialId: string | Types.ObjectId) {
    return ProcessingJob.findOne({ materialId: new Types.ObjectId(materialId) }).exec();
  }

  async hasPendingAttempts(job: IProcessingJob): Promise<boolean> {
    return job.attempts < job.maxAttempts;
  }

  /**
   * Re-arms the job for a user-initiated retry. The bounded-attempt budget resets
   * because the user is acting deliberately, not because a worker stage is retrying.
   */
  async markQueuedForRetry(materialId: string | Types.ObjectId) {
    return this.model
      .findOneAndUpdate(
        this.scope({ materialId: new Types.ObjectId(materialId) } as FilterQuery<IProcessingJob>),
        {
          $set: { status: 'queued', leaseUntil: null, startedAt: null, completedAt: null },
          $setOnInsert: { attempts: 0, maxAttempts: MAX_PROCESSING_ATTEMPTS },
        },
        { new: true, upsert: true },
      )
      .exec();
  }
}

export function leaseExpiryFromNow(): Date {
  return new Date(Date.now() + LEASE_MS);
}
