import { z } from 'zod';
import { objectIdSchema, strictObject } from './common';
import { MAX_LESSON_CONTENT_LENGTH } from '@/lib/db/models/lesson';

/** Titles are 1–200 characters with no restriction beyond length. */
export const lessonTitleSchema = z.string().min(1).max(200);

export const lessonContentSchema = z
  .string()
  .max(MAX_LESSON_CONTENT_LENGTH, 'Lesson content is larger than the 1 MB limit.');

export const lessonSaveSchema = strictObject({
  version: z.number().int().min(1),
  title: lessonTitleSchema,
  contentMarkdown: lessonContentSchema,
});

export const restoreRevisionSchema = strictObject({
  version: z.number().int().min(1),
});

export const lessonIdParamsSchema = strictObject({
  lessonId: objectIdSchema,
});

/** Request body for POST /api/lessons/generate (specs/005): 1-5 distinct sources. */
export const generateLessonRequestSchema = strictObject({
  title: lessonTitleSchema,
  materialIds: z
    .array(objectIdSchema)
    .min(1)
    .max(5)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Source materials must be distinct',
    }),
});

/** Request body for POST /api/lessons/{lessonId}/regenerate (CAS on version). */
export const regenerateLessonSchema = strictObject({
  version: z.number().int().min(1),
  materialIds: z
    .array(objectIdSchema)
    .min(1)
    .max(5)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Source materials must be distinct',
    })
    .optional(),
});

export const requestIdParamsSchema = strictObject({
  requestId: objectIdSchema,
});

export const revisionIdParamsSchema = strictObject({
  lessonId: objectIdSchema,
  revisionId: objectIdSchema,
});

export type LessonSaveInput = z.infer<typeof lessonSaveSchema>;
export type RestoreRevisionInput = z.infer<typeof restoreRevisionSchema>;
export type GenerateLessonRequestInput = z.infer<typeof generateLessonRequestSchema>;
export type RegenerateLessonInput = z.infer<typeof regenerateLessonSchema>;
