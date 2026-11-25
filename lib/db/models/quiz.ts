import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export const QUIZ_STATUSES = ['queued', 'processing', 'ready', 'failed'] as const;
export type QuizStatus = (typeof QUIZ_STATUSES)[number];

export const QUIZ_LEASE_MS = 15 * 60 * 1000;

/** Fixed quiz lengths (TODO step 14): 20, 30, or 50 multiple-choice items. */
export const QUIZ_ITEM_COUNTS = [20, 30, 50] as const;
export type QuizItemCount = (typeof QUIZ_ITEM_COUNTS)[number];

/** Schema-level ceiling: 7 (the plus plan's max sources). */
export const MAX_LESSONS_PER_QUIZ = 7;

export interface IQuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  /** Lesson the question draws from (model-attributed, validated worker-side). */
  sourceLessonId: mongoose.Types.ObjectId | null;
  sourceLessonTitle: string | null;
}

export interface IQuizAttempt {
  /** Option index per question; -1 marks a skipped question. */
  answers: number[];
  scoreCorrect: number;
  scoreTotal: number;
  submittedAt: Date;
}

export interface IQuiz {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  /** User-supplied quiz title. */
  title: string;
  itemCount: QuizItemCount;
  /** 1-7 source lessons (distinct); the plan caps the count at admission. */
  sourceLessonIds: mongoose.Types.ObjectId[];
  status: QuizStatus;
  questions: IQuizQuestion[];
  /** Completed attempts (unlimited retakes, TODO step 16). */
  attempts: IQuizAttempt[];
  /** Worker lease for crash recovery (same pattern as generation requests). */
  leaseUntil: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const questionSchema = new Schema<IQuizQuestion>(
  {
    question: { type: String, required: true, maxlength: 300 },
    options: {
      type: [String],
      required: true,
      validate: {
        validator: (value: unknown) =>
          Array.isArray(value) && value.length === 4 && value.every((option) => typeof option === 'string' && option.length >= 1 && option.length <= 120),
        message: 'Every question carries exactly four options of 1-120 characters',
      },
    },
    correctIndex: { type: Number, required: true, min: 0, max: 3 },
    explanation: { type: String, default: null, maxlength: 300 },
    sourceLessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', default: null },
    sourceLessonTitle: { type: String, default: null, maxlength: 200 },
  },
  { _id: false },
);

const attemptSchema = new Schema<IQuizAttempt>(
  {
    answers: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: unknown) =>
          Array.isArray(value) &&
          value.every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= 3),
        message: 'Every answer is an option index (0-3); all questions must be answered',
      },
    },
    scoreCorrect: { type: Number, required: true, min: 0 },
    scoreTotal: { type: Number, required: true, min: 1 },
    submittedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const quizSchema = new Schema<IQuiz>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, minlength: 1, maxlength: 200 },
    itemCount: {
      type: Number,
      required: true,
      enum: QUIZ_ITEM_COUNTS,
    },
    sourceLessonIds: {
      type: [Schema.Types.ObjectId],
      ref: 'Lesson',
      required: true,
      validate: {
        validator: (value: unknown) => {
          if (!Array.isArray(value)) return false;
          if (value.length < 1 || value.length > MAX_LESSONS_PER_QUIZ) return false;
          const keys = value.map((id) => String(id));
          return new Set(keys).size === keys.length;
        },
        message: 'A quiz draws from 1 to 7 distinct lessons',
      },
    },
    status: {
      type: String,
      enum: QUIZ_STATUSES,
      default: 'queued',
    },
    questions: { type: [questionSchema], default: [] },
    attempts: { type: [attemptSchema], default: [] },
    leaseUntil: { type: Date, default: null },
    lastErrorCode: { type: String, default: null },
    lastErrorMessage: { type: String, default: null },
  },
  { timestamps: true },
);

quizSchema.index({ userId: 1, createdAt: -1 });
quizSchema.index({ status: 1, leaseUntil: 1 });

export type QuizDocument = HydratedDocument<IQuiz>;

export const Quiz: Model<IQuiz> =
  (mongoose.models.Quiz as Model<IQuiz> | undefined) ??
  mongoose.model<IQuiz>('Quiz', quizSchema);
