import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export const REVISION_AUTHOR_TYPES = ['system', 'user'] as const;
export type RevisionAuthorType = (typeof REVISION_AUTHOR_TYPES)[number];

export interface ILessonRevision {
  _id: mongoose.Types.ObjectId;
  lessonId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  version: number;
  title: string;
  contentMarkdown: string;
  authorType: RevisionAuthorType;
  createdAt: Date;
}

const lessonRevisionSchema = new Schema<ILessonRevision>(
  {
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, maxlength: 200 },
    contentMarkdown: { type: String, required: true },
    authorType: { type: String, enum: REVISION_AUTHOR_TYPES, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

lessonRevisionSchema.index({ lessonId: 1, version: 1 }, { unique: true });
lessonRevisionSchema.index({ userId: 1, lessonId: 1, version: -1 });

const appendOnlyError = () => new Error('LessonRevision records are append-only');

lessonRevisionSchema.pre('findOneAndUpdate', function (next) {
  next(appendOnlyError());
});
lessonRevisionSchema.pre('updateOne', function (next) {
  next(appendOnlyError());
});
lessonRevisionSchema.pre('updateMany', function (next) {
  next(appendOnlyError());
});

export type LessonRevisionDocument = HydratedDocument<ILessonRevision>;

export const LessonRevision: Model<ILessonRevision> =
  (mongoose.models.LessonRevision as Model<ILessonRevision> | undefined) ??
  mongoose.model<ILessonRevision>('LessonRevision', lessonRevisionSchema);
