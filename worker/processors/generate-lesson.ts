import { getLogger } from '@/lib/logging/logger';
import { Types } from 'mongoose';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { ProcessingJobRepository } from '@/lib/db/repositories/processing-job-repository';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { getObjectBytes } from '@/lib/storage/s3';
import { extractDocument } from '@/lib/parsing/extract';
import { LessonRevision } from '@/lib/db/models/lesson-revision';
import { Lesson } from '@/lib/db/models/lesson';
import { Material } from '@/lib/db/models/material';
import {
  LessonGenerationRequest,
  REQUEST_LEASE_MS,
  type ILessonGenerationRequest,
} from '@/lib/db/models/lesson-generation-request';
import { withTransaction } from '@/lib/db/connection';
import { failureMessage } from '@/lib/materials/failure-messages';
import { sanitizeLessonContent } from '@/lib/security/sanitize';
import {
  generateLesson,
  LessonGenerationError,
} from '@/lib/ai/generate-lesson';
import { SOURCE_CHAR_CAP, TOTAL_SOURCE_CHAR_CAP } from '@/lib/ai/prompts';
import { auditEvents } from '@/lib/logging/audit-events';
import type {
  GenerateLessonJob,
  GenerateLessonRequestJob,
} from '@/lib/jobs/schemas';

const logger = getLogger().child({ processor: 'generate_lesson' });

type GenerationFailureCode =
  | 'generation_failed'
  | 'provider_unavailable'
  | 'budget_exceeded'
  | 'malformed_model_output'
  | 'material_unavailable'
  | 'parse_failed'
  | 'lesson_missing'
  | 'lesson_conflict';

function toFailureCode(error: unknown): GenerationFailureCode {
  if (error instanceof LessonGenerationError) {
    return error.code;
  }
  return 'generation_failed';
}

function requestFailureMessage(code: GenerationFailureCode): string {
  switch (code) {
    case 'material_unavailable':
      return 'One of the source materials is no longer available.';
    case 'lesson_missing':
      return 'The lesson to regenerate no longer exists.';
    case 'lesson_conflict':
      return 'The lesson changed during generation. Request the regeneration again.';
    case 'generation_failed':
    case 'provider_unavailable':
    case 'budget_exceeded':
    case 'malformed_model_output':
    case 'parse_failed':
      return failureMessage(code);
  }
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

  const processing = await materials.transition(
    materialId,
    ['queued', 'processing', 'ready'],
    'processing',
  );
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
            sourceMaterialIds: [materialId],
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
    // The legacy single-material path only ever produces AI failure codes,
    // which are a subset of the material codes.
    const materialCode = code as Parameters<typeof failureMessage>[0];
    await materials.markFailed(materialId, materialCode, failureMessage(materialCode));
    await jobs.markFailed(materialId, materialCode, failureMessage(materialCode));
    await auditEvents.generationFailed({
      userId,
      correlationId,
      metadata: { materialId, code },
    });
    logger.info({ materialId, code }, 'Lesson generation failed');
  }
}

/**
 * Explicit lesson generation (specs/005): processes a lesson-generation
 * request row — fetches and extracts every source material (per-source and
 * total caps with truncation notices), calls the model with the
 * user-supplied title, and either creates a new lesson with its initial
 * revision or CAS-appends a new revision to the lesson being regenerated.
 * The request row is the progress surface the polling API reads.
 */
export async function processGenerateLessonRequest(
  payload: GenerateLessonRequestJob,
): Promise<void> {
  const { requestId, materialIds, title, userId, correlationId } = payload;

  const requestLogger = logger.child({ requestId });
  const userObjectId = new Types.ObjectId(userId);

  const failRequest = async (
    request: ILessonGenerationRequest | null,
    code: GenerationFailureCode,
    detail?: unknown,
  ) => {
    const message = requestFailureMessage(code);
    if (request) {
      await LessonGenerationRequest.updateOne(
        { _id: request._id, userId: userObjectId },
        {
          $set: {
            status: 'failed',
            leaseUntil: null,
            lastErrorCode: code,
            lastErrorMessage: message,
          },
        },
      ).exec();
    }
    await auditEvents.generationFailed({
      userId,
      correlationId,
      metadata: { requestId, code },
    });
    requestLogger.info({ code }, 'Lesson generation request failed');
    if (detail) requestLogger.warn({ err: detail, code }, 'Generation request failure detail');
  };

  // Atomic claim with the same lease pattern as the material pipeline so a
  // dead worker's request can be picked up again after the lease expires.
  const now = new Date();
  const claimed = await LessonGenerationRequest.findOneAndUpdate(
    {
      _id: new Types.ObjectId(requestId),
      userId: userObjectId,
      $or: [
        { status: 'queued' },
        { status: 'processing', leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: 'processing',
        leaseUntil: new Date(now.getTime() + REQUEST_LEASE_MS),
      },
    },
    { new: true },
  ).exec();

  if (!claimed) {
    const existing = await LessonGenerationRequest.findOne({
      _id: new Types.ObjectId(requestId),
      userId: userObjectId,
    }).exec();
    if (existing?.status === 'ready') {
      requestLogger.info('Request already ready; redelivered job reconciled');
      return;
    }
    requestLogger.warn({ status: existing?.status }, 'Request not claimable');
    return;
  }

  // Fetch and extract every source; per-source and total caps apply with
  // truncation notices so the model knows the material is partial.
  const sources: Array<{ filename: string; detectedMime: string; text: string }> = [];
  let used = 0;
  for (const materialId of materialIds) {
    const material = await Material.findOne({
      _id: new Types.ObjectId(materialId),
      userId: userObjectId,
      status: 'ready',
    })
      .lean()
      .exec();
    if (!material) {
      await failRequest(claimed, 'material_unavailable', { materialId });
      return;
    }

    try {
      const bytes = await getObjectBytes(material.storageKey);
      const detectedMime = material.detectedMime ?? material.declaredMime;
      const extracted = await extractDocument(bytes, detectedMime);
      const capped = extracted.text.slice(
        0,
        Math.max(0, Math.min(SOURCE_CHAR_CAP, TOTAL_SOURCE_CHAR_CAP - used)),
      );
      if (capped.length === 0) continue;
      used += capped.length;
      sources.push({
        filename: material.originalFilename,
        detectedMime,
        text: capped,
      });
    } catch (error) {
      requestLogger.warn({ err: error, materialId }, 'Source extraction failed');
      await failRequest(claimed, 'parse_failed', { materialId });
      return;
    }
  }

  try {
    const generated = await generateLesson({
      userId,
      title,
      sources,
      // The single-source fields stay required by the input type; multi-source
      // inputs ignore them.
      filename: sources[0]?.filename ?? 'sources',
      detectedMime: sources[0]?.detectedMime ?? 'application/octet-stream',
      text: '',
    });

    const contentMarkdown = sanitizeLessonContent(generated.markdown);
    if (contentMarkdown.length === 0) {
      throw new LessonGenerationError('malformed_model_output', 'The generated lesson was empty.');
    }

    const sourceObjectIds = materialIds.map((id) => new Types.ObjectId(id));
    const lessonId = await withTransaction(async (session) => {
      let lessonMongoId: Types.ObjectId;

      if (claimed.existingLessonId) {
        // Regeneration: CAS on the version the requester saw (save-service
        // pattern) and an append-only system revision.
        const current = await Lesson.findOne({
          _id: claimed.existingLessonId,
          userId: userObjectId,
        })
          .session(session)
          .exec();
        if (!current) {
          await failRequest(claimed, 'lesson_missing');
          return null;
        }

        const updated = await Lesson.findOneAndUpdate(
          {
            _id: current._id,
            userId: userObjectId,
            version: current.version,
          },
          {
            $set: {
              title: generated.lesson.title,
              summary: generated.lesson.summary,
              contentMarkdown,
              sourceMaterialIds: sourceObjectIds,
              materialId: sourceObjectIds[0],
              generationProvider: generated.provider,
              generationModel: generated.model,
              promptVersion: generated.promptVersion,
              status: 'ready',
            },
            $inc: { version: 1 },
          },
          { new: true, session },
        ).exec();
        if (!updated) {
          await failRequest(claimed, 'lesson_conflict');
          return null;
        }
        lessonMongoId = updated._id;

        await LessonRevision.create(
          [
            {
              userId: userObjectId,
              lessonId: updated._id,
              version: updated.version,
              title: updated.title,
              contentMarkdown: updated.contentMarkdown,
              authorType: 'system',
            },
          ],
          { session },
        );
      } else {
        const [created] = await Lesson.create(
          [
            {
              userId: userObjectId,
              materialId: sourceObjectIds[0],
              sourceMaterialIds: sourceObjectIds,
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
              userId: userObjectId,
              lessonId: created._id,
              version: 1,
              title: created.title,
              contentMarkdown: created.contentMarkdown,
              authorType: 'system',
            },
          ],
          { session },
        );
        lessonMongoId = created._id;
      }

      const settled = await LessonGenerationRequest.findOneAndUpdate(
        { _id: claimed._id, userId: userObjectId, status: 'processing' },
        {
          $set: {
            status: 'ready',
            lessonId: lessonMongoId,
            leaseUntil: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        },
        { new: true },
      ).exec();
      if (!settled) {
        requestLogger.warn('Request row was not in processing state at completion');
      }
      return lessonMongoId;
    });

    if (!lessonId) return;

    await auditEvents.generationSucceeded({
      userId,
      correlationId,
      metadata: {
        requestId,
        lessonId: lessonId.toHexString(),
        provider: generated.provider,
        regenerated: Boolean(claimed.existingLessonId),
      },
    });
    requestLogger.info(
      { lessonId: lessonId.toHexString(), sources: materialIds.length },
      'Lesson generation request completed',
    );
  } catch (error) {
    const code = toFailureCode(error);
    await failRequest(claimed, code, error);
  }
}
