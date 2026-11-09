import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export const DELETION_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

export interface IAccountDeletionRequest {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  status: DeletionStatus;
  attempts: number;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const accountDeletionRequestSchema = new Schema<IAccountDeletionRequest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: DELETION_STATUSES, default: 'queued' },
    attempts: { type: Number, default: 0, min: 0, max: 3 },
    requestedAt: { type: Date, required: true, default: () => new Date() },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failureCode: { type: String, default: null },
  },
  { timestamps: true },
);

accountDeletionRequestSchema.index({ userId: 1 }, { unique: true });
accountDeletionRequestSchema.index({ status: 1, requestedAt: 1 });

export type AccountDeletionRequestDocument = HydratedDocument<IAccountDeletionRequest>;

export const AccountDeletionRequest: Model<IAccountDeletionRequest> =
  (mongoose.models.AccountDeletionRequest as Model<IAccountDeletionRequest> | undefined) ??
  mongoose.model<IAccountDeletionRequest>(
    'AccountDeletionRequest',
    accountDeletionRequestSchema,
  );
