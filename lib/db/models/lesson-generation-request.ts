import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export const LESSON_GENERATION_REQUEST_STATUSES = [
  'queued',
  'processing',
  'ready',
  'failed',
] as const;
export type LessonGenerationRequestStatus =
  (typeof LESSON_GENERATION_REQUEST_STATUSES)[number];

export const REQUEST_LEASE_MS = 10 * 60 * 1000;

export const MAX_MATERIALS_PER_REQUEST = 5;

export interface ILessonGenerationRequest {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  /** User-supplied lesson title (the generated lesson uses exactly this). */
  title: string;
  /** 1-5 source materials (distinct); the first one becomes the primary. */
  materialIds: mongoose.Types.ObjectId[];
  /** Set when the request regenerates an existing lesson (CAS on its version). */
  existingLessonId: mongoose.Types.ObjectId | null;
  status: LessonGenerationRequestStatus;
  /** The created or regenerated lesson, set when the request turns ready. */
  lessonId: mongoose.Types.ObjectId | null;
  /** Worker lease for crash recovery (same pattern as ProcessingJob). */
  leaseUntil: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const requestSchema = new Schema<ILessonGenerationRequest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, minlength: 1, maxlength: 200 },
    materialIds: {
      type: [Schema.Types.ObjectId],
      ref: 'Material',
      required: true,
      validate: {
        validator: (value: unknown) => {
          if (!Array.isArray(value)) return false;
          if (value.length < 1 || value.length > MAX_MATERIALS_PER_REQUEST) return false;
          const keys = value.map((id) => String(id));
          return new Set(keys).size === keys.length;
        },
        message: 'A generation request needs 1 to 5 distinct source materials',
      },
    },
    existingLessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', default: null },
    status: {
      type: String,
      enum: LESSON_GENERATION_REQUEST_STATUSES,
      default: 'queued',
    },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', default: null },
    leaseUntil: { type: Date, default: null },
    lastErrorCode: { type: String, default: null },
    lastErrorMessage: { type: String, default: null },
  },
  { timestamps: true },
);

requestSchema.index({ userId: 1, createdAt: -1 });
requestSchema.index({ status: 1, leaseUntil: 1 });

export type LessonGenerationRequestDocument = HydratedDocument<ILessonGenerationRequest>;

export const LessonGenerationRequest: Model<ILessonGenerationRequest> =
  (mongoose.models.LessonGenerationRequest as
    | Model<ILessonGenerationRequest>
    | undefined) ??
  mongoose.model<ILessonGenerationRequest>('LessonGenerationRequest', requestSchema);
