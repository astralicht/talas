import { getLogger } from '@/lib/logging/logger';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { ProcessingJobRepository } from '@/lib/db/repositories/processing-job-repository';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { getObjectBytes } from '@/lib/storage/s3';
import { extractDocument } from '@/lib/parsing/extract';
import { LessonRevision } from '@/lib/db/models/lesson-revision';
import { Lesson } from '@/lib/db/models/lesson';
import { withTransaction } from '@/lib/db/connection';
import { failureMessage } from '@/lib/materials/failure-messages';
import { sanitizeLessonContent } from '@/lib/security/sanitize';
import {
  generateLesson,
  LessonGenerationError,
} from '@/lib/ai/generate-lesson';
import { auditEvents } from '@/lib/logging/audit-events';
import type { GenerateLessonJob } from '@/lib/jobs/schemas';

const logger = getLogger().child({ processor: 'generate_lesson' });

type GenerationFailureCode =
  | 'generation_failed'
  | 'provider_unavailable'
  | 'budget_exceeded'
  | 'malformed_model_output';

function toFailureCode(error: unknown): GenerationFailureCode {
  if (error instanceof LessonGenerationError) {
    return error.code;
  }
  return 'generation_failed';
}

/**
 * Generates the structured lesson from the stored document and persists it with
 * exactly one initial system revision. The unique `materialId` index plus the
 * existence check make re-delivered jobs idempotent: no duplicate lessons.
 */
export async function processGenerateLesson(payload: GenerateLessonJob): Promise<void> {
  const { materialId, userId, correlationId } = payload;

  const materials = new MaterialRepository(userId);
  const jobs = new ProcessingJobRepository(userId);
  const lessons = new LessonRepository(userId);

  const claimed = await jobs.claimForStage(materialId);
  if (!claimed) {
    logger.warn({ materialId }, 'Generation stage already claimed or finished');
    return;
  }

  const material = await materials.findForWorker(materialId);
  if (!material) {
    await jobs.markFailed(materialId, 'upload_missing', 'The uploaded material no longer exists.');
    return;
  }

  const processing = await materials.transition(materialId, ['processing'], 'processing');
  if (!processing) {
    // Idempotent completion: the lesson may already exist from an earlier delivery.
    const existing = await lessons.findByMaterialId(materialId);
    if (existing) {
      await materials.transition(materialId, ['processing', 'queued'], 'ready');
      await jobs.markReady(materialId);
    }
    logger.warn({ materialId, status: material.status }, 'Material skipped generation stage');
    return;
  }

  const existing = await lessons.findByMaterialId(materialId);
  if (existing) {
    await materials.transition(materialId, ['processing'], 'ready');
    await jobs.markReady(materialId);
    logger.info({ materialId }, 'Lesson already present; generation results reconciled');
    return;
  }

  let text: string;
  try {
    const bytes = await getObjectBytes(material.storageKey);
    const detectedMime = material.detectedMime ?? material.declaredMime;
    const extracted = await extractDocument(bytes, detectedMime);
    text = extracted.text;
  } catch (error) {
    logger.warn({ err: error, materialId }, 'Re-extraction failed before generation');
    await materials.markFailed(
      materialId,
      'parse_failed',
      failureMessage('parse_failed'),
    );
    await jobs.markFailed(materialId, 'parse_failed', failureMessage('parse_failed'));
    await auditEvents.generationFailed({
      userId,
      correlationId,
      metadata: { materialId, code: 'parse_failed' },
    });
    return;
  }

  const filename = material.originalFilename;
  const detectedMime = material.detectedMime ?? material.declaredMime;

  try {
    const generated = await generateLesson({
      userId,
      filename,
      detectedMime,
      text,
    });

    const contentMarkdown = sanitizeLessonContent(generated.markdown);
    if (contentMarkdown.length === 0) {
      throw new LessonGenerationError('malformed_model_output', 'The generated lesson was empty.');
    }

    const lesson = await withTransaction(async (session) => {
      const [created] = await Lesson.create(
        [
          {
            userId,
            materialId,
            title: generated.lesson.title,
            summary: generated.lesson.summary,
            contentMarkdown,
            version: 1,
            status: 'ready',
            generationProvider: generated.provider,
            generationModel: generated.model,
            promptVersion: generated.promptVersion,
          },
        ],
        { session },
      );
      if (!created) throw new Error('Lesson could not be created');

      await LessonRevision.create(
        [
          {
            userId,
            lessonId: created._id,
            version: 1,
            title: created.title,
            contentMarkdown: created.contentMarkdown,
            authorType: 'system',
          },
        ],
        { session },
      );
      return created;
    });

    await materials.transition(materialId, ['processing'], 'ready');
    await jobs.markReady(materialId);

    await auditEvents.generationSucceeded({
      userId,
      correlationId,
      metadata: { materialId, lessonId: lesson._id.toHexString(), provider: generated.provider },
    });
    logger.info({ materialId, lessonId: lesson._id.toHexString() }, 'Lesson generated');
  } catch (error) {
    const code = toFailureCode(error);
    await materials.markFailed(materialId, code, failureMessage(code));
    await jobs.markFailed(materialId, code, failureMessage(code));
    await auditEvents.generationFailed({
      userId,
      correlationId,
      metadata: { materialId, code },
    });
    logger.info({ materialId, code }, 'Lesson generation failed');
  }
}
