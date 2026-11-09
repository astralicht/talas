import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export const AUDIT_EVENT_TYPES = [
  'registration',
  'verification_sent',
  'email_verified',
  'sign_in',
  'sign_in_failed',
  'account_locked',
  'token_refresh',
  'refresh_reuse_detected',
  'sign_out',
  'password_reset_requested',
  'password_reset_completed',
  'export_requested',
  'account_deletion_requested',
  'account_deleted',
  'authorization_denied',
  'upload_confirmed',
  'scan_clean',
  'scan_infected',
  'scan_unavailable',
  'generation_succeeded',
  'generation_failed',
  'material_retry',
  'material_deleted',
  'material_downloaded',
  'lesson_saved',
  'revision_restored',
  'lesson_deleted',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export interface IAuditEvent {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId | null;
  type: AuditEventType;
  correlationId: string;
  ipHash: string;
  userAgentHash: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const auditEventSchema = new Schema<IAuditEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: AUDIT_EVENT_TYPES, required: true },
    correlationId: { type: String, required: true },
    ipHash: { type: String, required: true },
    userAgentHash: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditEventSchema.index({ userId: 1, createdAt: -1 });
auditEventSchema.index({ type: 1, createdAt: -1 });
auditEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 });

export type AuditEventDocument = HydratedDocument<IAuditEvent>;

export const AuditEvent: Model<IAuditEvent> =
  (mongoose.models.AuditEvent as Model<IAuditEvent> | undefined) ??
  mongoose.model<IAuditEvent>('AuditEvent', auditEventSchema);
