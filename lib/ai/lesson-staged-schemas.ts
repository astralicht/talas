import { z } from 'zod';
import { MAX_LESSON_CONTENT_LENGTH } from '@/lib/db/models/lesson';

/**
 * Staged lesson-generation schemas (TODO step 18): the single big
 * generateObject call made reasoning models burn their entire output budget
 * drafting inside hidden reasoning before emitting any JSON. The pipeline now
 * runs three small calls — outline, one per section, quiz — each small
 * enough that reasoning cannot exhaust the token cap.
 */

export const outlineSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    learningObjectives: z.array(z.string().min(1).max(500)).max(8).optional(),
    sections: z
      .array(
        z
          .object({
            heading: z.string().min(1).max(200),
            figureUrl: z
              .string()
              .startsWith('/api/materials/')
              .optional(),
          })
          .strict(),
      )
      .min(3)
      .max(8),
  })
  .strict();

export const sectionSchema = z
  .object({
    contentMarkdown: z.string().min(1).max(MAX_LESSON_CONTENT_LENGTH),
    keyPoints: z.array(z.string().min(1).max(500)).max(20).optional(),
    misconceptions: z.array(z.string().min(1).max(500)).max(5).optional(),
    checkUnderstanding: z.array(z.string().min(1).max(500)).max(5).optional(),
  })
  .strict();

export const quizSchema = z
  .object({
    quiz: z
      .array(
        z
          .object({
            question: z.string().min(1).max(300),
            options: z.array(z.string().min(1).max(120)).length(4),
            correctIndex: z.number().int().min(0).max(3),
            explanation: z.string().max(300).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();

export type LessonOutline = z.infer<typeof outlineSchema>;
export type LessonSectionBody = z.infer<typeof sectionSchema>;
export type LessonQuiz = z.infer<typeof quizSchema>;
