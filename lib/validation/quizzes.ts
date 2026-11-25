import { z } from 'zod';
import { objectIdSchema, strictObject } from './common';
import { MAX_LESSONS_PER_QUIZ } from '@/lib/db/models/quiz';

/** Titles are 1–200 characters with no restriction beyond length. */
export const quizTitleSchema = z.string().min(1).max(200);

/** Fixed quiz lengths (TODO step 14): 20, 30, or 50 items. */
export const quizItemCountSchema = z.union([
  z.literal(20),
  z.literal(30),
  z.literal(50),
]);

/**
 * Request body for POST /api/quizzes: 1-7 distinct source lessons at the
 * schema level; the tier's max (3 free / 7 plus) is a 403 quota decision, not
 * a validation error.
 */
export const createQuizSchema = strictObject({
  title: quizTitleSchema,
  itemCount: quizItemCountSchema,
  lessonIds: z
    .array(objectIdSchema)
    .min(1)
    .max(MAX_LESSONS_PER_QUIZ)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Source lessons must be distinct',
    }),
});

export const quizIdParamsSchema = strictObject({
  quizId: objectIdSchema,
});

/** Optional attempt selector for GET /api/quizzes/{id} (1-based). */
export const quizAttemptQuerySchema = strictObject({
  attempt: z.coerce.number().int().min(1).optional(),
});

/**
 * Request body for POST /api/quizzes/{id}/submit (TODO step 16): one option
 * index per question; -1 marks a skipped question. The route checks the
 * length against the quiz's itemCount.
 */
export const submitQuizSchema = strictObject({
  answers: z
    .array(z.number().int().min(-1).max(3))
    .min(1)
    .max(50),
});

export type CreateQuizInput = z.infer<typeof createQuizSchema>;
export type SubmitQuizInput = z.infer<typeof submitQuizSchema>;
