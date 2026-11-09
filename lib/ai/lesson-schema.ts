import { z } from 'zod';

export const generatedLessonSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(2_000),
    sections: z
      .array(
        z
          .object({
            heading: z.string().min(1).max(200),
            contentMarkdown: z.string().min(1).max(20_000),
            keyPoints: z.array(z.string().min(1).max(500)).max(20).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export type GeneratedLesson = z.infer<typeof generatedLessonSchema>;

export type LessonGenerationResult =
  | { ok: true; lesson: GeneratedLesson }
  | { ok: false; reason: 'malformed_output'; issues: string[] };

export function parseGeneratedLesson(value: unknown): LessonGenerationResult {
  const parsed = generatedLessonSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'malformed_output',
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'object'}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, lesson: parsed.data };
}
