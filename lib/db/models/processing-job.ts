import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export const PROCESSING_JOB_STATUSES = ['queued', 'processing', 'ready', 'failed'] as const;
export type ProcessingJobStatus = (typeof PROCESSING_JOB_STATUSES)[number];

export const MAX_PROCESSING_ATTEMPTS = 3;

export interface IProcessingJob {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  materialId: mongoose.Types.ObjectId;
  status: ProcessingJobStatus;
  attempts: number;
  maxAttempts: number;
  leaseUntil: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const processingJobSchema = new Schema<IProcessingJob>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    materialId: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
    status: { type: String, enum: PROCESSING_JOB_STATUSES, default: 'queued' },
    attempts: { type: Number, default: 0, min: 0, max: MAX_PROCESSING_ATTEMPTS },
    maxAttempts: { type: Number, default: MAX_PROCESSING_ATTEMPTS, min: 1, max: MAX_PROCESSING_ATTEMPTS },
    leaseUntil: { type: Date, default: null },
    lastErrorCode: { type: String, default: null },
    lastErrorMessage: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

processingJobSchema.index({ materialId: 1 }, { unique: true });
processingJobSchema.index({ status: 1, leaseUntil: 1 });
processingJobSchema.index({ userId: 1, createdAt: -1 });

export type ProcessingJobDocument = HydratedDocument<IProcessingJob>;

export const ProcessingJob: Model<IProcessingJob> =
  (mongoose.models.ProcessingJob as Model<IProcessingJob> | undefined) ??
  mongoose.model<IProcessingJob>('ProcessingJob', processingJobSchema);
