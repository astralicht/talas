import type { IMaterial } from '@/lib/db/models/material';
import type { ILesson } from '@/lib/db/models/lesson';
import type { ILessonGenerationRequest } from '@/lib/db/models/lesson-generation-request';
import type { ILessonRevision } from '@/lib/db/models/lesson-revision';
import type { IQuiz } from '@/lib/db/models/quiz';

export interface MaterialView {
  id: string;
  originalFilename: string;
  detectedMime: string | null;
  sizeBytes: number;
  status: IMaterial['status'];
  scanResult: IMaterial['scanResult'];
  pageCount: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
}

export function serializeMaterial(material: IMaterial): MaterialView {
  return {
    id: material._id.toHexString(),
    originalFilename: material.originalFilename,
    detectedMime: material.detectedMime,
    sizeBytes: material.sizeBytes,
    status: material.status,
    scanResult: material.scanResult,
    pageCount: material.pageCount,
    failureCode: material.failureCode,
    failureMessage: material.failureMessage,
    createdAt: material.createdAt,
  };
}

export interface LessonSummaryView {
  id: string;
  title: string;
  version: number;
  updatedAt: Date;
}

export interface LessonView {
  id: string;
  materialId: string;
  title: string;
  summary: string;
  contentMarkdown: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeLessonSummary(lesson: ILesson): LessonSummaryView {
  return {
    id: lesson._id.toHexString(),
    title: lesson.title,
    version: lesson.version,
    updatedAt: lesson.updatedAt,
  };
}

export function serializeLesson(lesson: ILesson): LessonView {
  return {
    id: lesson._id.toHexString(),
    materialId: lesson.materialId.toHexString(),
    title: lesson.title,
    summary: lesson.summary,
    contentMarkdown: lesson.contentMarkdown,
    version: lesson.version,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
  };
}

export interface LessonGenerationRequestView {
  requestId: string;
  status: ILessonGenerationRequest['status'];
  title: string;
  materialIds: string[];
  lessonId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export function serializeLessonGenerationRequest(
  request: ILessonGenerationRequest,
): LessonGenerationRequestView {
  return {
    requestId: request._id.toHexString(),
    status: request.status,
    title: request.title,
    materialIds: request.materialIds.map((id) => id.toHexString()),
    lessonId: request.lessonId ? request.lessonId.toHexString() : null,
    lastErrorCode: request.lastErrorCode,
    lastErrorMessage: request.lastErrorMessage,
  };
}

export interface QuizView {
  id: string;
  status: string;
  title: string;
  itemCount: number;
  sourceLessonIds: string[];
  createdAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export interface QuizReadyView extends QuizView {
  /**
   * Questions without the answer key — `correctIndex` and `explanation`
   * deliberately stay out of every API response until a later step adds
   * answer-reveal/scored modes (TODO step 14).
   */
  questions: Array<{
    question: string;
    options: string[];
  }>;
}

export function serializeQuiz(quiz: IQuiz): QuizView {
  return {
    id: quiz._id.toHexString(),
    status: quiz.status,
    title: quiz.title,
    itemCount: quiz.itemCount,
    sourceLessonIds: quiz.sourceLessonIds.map((id) => id.toHexString()),
    createdAt: quiz.createdAt.toISOString(),
    lastErrorCode: quiz.lastErrorCode,
    lastErrorMessage: quiz.lastErrorMessage,
  };
}

export interface QuizAttemptSummaryView {
  attemptNumber: number;
  scoreCorrect: number;
  scoreTotal: number;
  submittedAt: string;
}

export interface QuizAttemptQuestionView {
  question: string;
  options: string[];
  yourAnswer: number | null;
  correctIndex: number;
  correct: boolean;
  explanation: string | null;
}

export interface QuizResultsView extends QuizView {
  attemptNumber: number;
  score: { correct: number; total: number };
  /** Per-question reveal — safe to expose only after that attempt's submission. */
  questions: QuizAttemptQuestionView[];
  /** Score history across all attempts (unlimited retakes, TODO step 16). */
  history: QuizAttemptSummaryView[];
}

/** Ready-quiz view with the answer key withheld (TODO step 14). */
export function serializeQuizReady(quiz: IQuiz): QuizReadyView {
  return {
    ...serializeQuiz(quiz),
    questions: quiz.questions.map((question) => ({
      question: question.question,
      options: [...question.options],
    })),
  };
}

/**
 * Results view for one stored attempt (TODO step 16): the user's picks, the
 * correct options, and the explanations — exposed only because the attempt
 * was already submitted.
 */
export function serializeQuizAttemptResults(
  quiz: IQuiz,
  attemptIndex: number,
): QuizResultsView {
  const attempt = quiz.attempts[attemptIndex];
  if (!attempt) throw new Error(`Attempt ${attemptIndex} does not exist`);
  const attemptNumber = attemptIndex + 1;
  const questions = quiz.questions.map((question, questionIndex) => {
    const yourAnswer = attempt.answers[questionIndex] ?? -1;
    return {
      question: question.question,
      options: [...question.options],
      yourAnswer: yourAnswer === -1 ? null : yourAnswer,
      correctIndex: question.correctIndex,
      correct: yourAnswer === question.correctIndex,
      explanation: question.explanation,
    };
  });
  return {
    ...serializeQuiz(quiz),
    attemptNumber,
    score: { correct: attempt.scoreCorrect, total: attempt.scoreTotal },
    questions,
    history: quiz.attempts.map((stored, index) => ({
      attemptNumber: index + 1,
      scoreCorrect: stored.scoreCorrect,
      scoreTotal: stored.scoreTotal,
      submittedAt: stored.submittedAt.toISOString(),
    })),
  };
}

export interface RevisionView {
  id: string;
  version: number;
  authorType: ILessonRevision['authorType'];
  createdAt: Date;
}

export function serializeRevision(revision: ILessonRevision): RevisionView {
  return {
    id: revision._id.toHexString(),
    version: revision.version,
    authorType: revision.authorType,
    createdAt: revision.createdAt,
  };
}
