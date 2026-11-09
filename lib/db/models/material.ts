import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export const MATERIAL_STATUSES = [
  'awaiting_upload',
  'uploaded',
  'scanning',
  'queued',
  'processing',
  'ready',
  'failed',
  'quarantined',
  'deleted',
] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export const SCAN_RESULTS = ['pending', 'clean', 'infected', 'unavailable'] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_UPLOAD_BYTES = 26_214_400;

export interface IMaterial {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  originalFilename: string;
  storageKey: string;
  declaredMime: string;
  detectedMime: string | null;
  sizeBytes: number;
  status: MaterialStatus;
  scanResult: ScanResult;
  pageCount: number | null;
  charCount: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  uploadExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const materialSchema = new Schema<IMaterial>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    originalFilename: { type: String, required: true, maxlength: 255 },
    storageKey: {
      type: String,
      required: true,
      match: /^materials\/[a-f0-9]{24}\/[a-f0-9]{24}$/,
    },
    declaredMime: { type: String, required: true },
    detectedMime: { type: String, enum: [...ALLOWED_MIME_TYPES, null], default: null },
    sizeBytes: { type: Number, required: true, min: 1, max: MAX_UPLOAD_BYTES },
    status: { type: String, enum: MATERIAL_STATUSES, default: 'awaiting_upload' },
    scanResult: { type: String, enum: SCAN_RESULTS, default: 'pending' },
    pageCount: { type: Number, default: null, min: 0 },
    charCount: { type: Number, default: null, min: 0, max: 2_000_000 },
    failureCode: { type: String, default: null },
    failureMessage: { type: String, default: null },
    uploadExpiresAt: { type: Date, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

materialSchema.index({ storageKey: 1 }, { unique: true });
materialSchema.index({ userId: 1, createdAt: -1 });
materialSchema.index({ userId: 1, status: 1 });
materialSchema.index({ status: 1, createdAt: 1 });

export type MaterialDocument = HydratedDocument<IMaterial>;

export const Material: Model<IMaterial> =
  (mongoose.models.Material as Model<IMaterial> | undefined) ??
  mongoose.model<IMaterial>('Material', materialSchema);
