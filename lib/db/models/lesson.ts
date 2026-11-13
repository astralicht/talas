import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export const LESSON_STATUSES = ['draft', 'ready', 'deleted'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const MAX_LESSON_CONTENT_LENGTH = 1_048_576;

export interface ILesson {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  /** Primary (first) source material. Kept for the single-material era API. */
  materialId: mongoose.Types.ObjectId;
  /** All source materials this lesson was generated from (1-5, distinct). */
  sourceMaterialIds: mongoose.Types.ObjectId[];
  title: string;
  summary: string;
  contentMarkdown: string;
  version: number;
  status: LessonStatus;
  generationProvider: string;
  generationModel: string;
  promptVersion: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export const MIN_SOURCES_PER_LESSON = 1;
export const MAX_SOURCES_PER_LESSON = 5;

function distinctSources(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (
    value.length < MIN_SOURCES_PER_LESSON ||
    value.length > MAX_SOURCES_PER_LESSON
  ) {
    return false;
  }
  const keys = value.map((id) => String(id));
  return new Set(keys).size === keys.length;
}

const lessonSchema = new Schema<ILesson>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    materialId: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
    sourceMaterialIds: {
      type: [Schema.Types.ObjectId],
      ref: 'Material',
      required: true,
      validate: {
        validator: distinctSources,
        message: 'A lesson needs 1 to 5 distinct source materials',
      },
    },
    title: { type: String, required: true, minlength: 1, maxlength: 200 },
    summary: { type: String, required: true, maxlength: 2_000 },
    contentMarkdown: { type: String, required: true, maxlength: MAX_LESSON_CONTENT_LENGTH },
    version: { type: Number, required: true, min: 1, default: 1 },
    status: { type: String, enum: LESSON_STATUSES, default: 'ready' },
    generationProvider: { type: String, required: true, default: 'unknown' },
    generationModel: { type: String, required: true, default: 'unknown' },
    promptVersion: { type: String, required: true, default: 'v1' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

lessonSchema.index({ userId: 1, materialId: 1 });
lessonSchema.index({ userId: 1, updatedAt: -1 });
lessonSchema.index({ userId: 1, status: 1 });

export type LessonDocument = HydratedDocument<ILesson>;

export const Lesson: Model<ILesson> =
  (mongoose.models.Lesson as Model<ILesson> | undefined) ??
  mongoose.model<ILesson>('Lesson', lessonSchema);
