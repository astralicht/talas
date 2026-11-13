import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { accepted } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { lessonIdParamsSchema, regenerateLessonSchema } from '@/lib/validation/lessons';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { Material } from '@/lib/db/models/material';
import {
  LessonGenerationRequest,
} from '@/lib/db/models/lesson-generation-request';
import { enqueueLessonGenerationJob } from '@/lib/jobs/queues';
import { serializeLessonGenerationRequest } from '@/lib/http/serializers';
import { auditEvents } from '@/lib/logging/audit-events';

export const dynamic = 'force-dynamic';

const paramsSchema = lessonIdParamsSchema;

/**
 * Regenerates an existing lesson (specs/005): compare-and-swap on the version
 * the requester saw, optional replacement source list. The request row carries
 * `existingLessonId`; the worker CAS-appends a new system revision on success.
 * Foreign/unknown sources answer the same non-revealing 404 as the generate
 * route, and a stale version fails with the optimistic-concurrency conflict.
 */
export const POST = route(
  { auth: true, verified: true, csrf: true, params: paramsSchema, body: regenerateLessonSchema },
  async ({ user, params, body, correlationId }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    const repository = new LessonRepository(user.id);
    const lesson = await repository.findOwnedById(params.lessonId);
    if (!lesson) throw errors.notFound();

    if (lesson.version !== body.version) {
      throw errors.conflict('This lesson changed while you were editing. Reload to continue.');
    }

    const requestedIds = (body.materialIds ?? lesson.sourceMaterialIds.map((id) => id.toHexString()))
      .map((id) => new Types.ObjectId(id));
    const distinctIds = requestedIds.filter(
      (id, index) => requestedIds.findIndex((other) => other.equals(id)) === index,
    );

    const readyMaterials = await Material.find({
      _id: { $in: distinctIds },
      userId: user.id,
      status: 'ready',
    })
      .select('_id')
      .lean()
      .exec();
    if (readyMaterials.length !== distinctIds.length) {
      throw errors.notFound();
    }

    const [request] = await LessonGenerationRequest.create([
      {
        userId: user.id,
        title: lesson.title,
        materialIds: distinctIds,
        existingLessonId: lesson._id,
        status: 'queued',
      },
    ]);
    if (!request) throw new Error('Generation request could not be created');

    try {
      await enqueueLessonGenerationJob({
        type: 'generate_lesson_request',
        requestId: request._id.toHexString(),
        materialIds: distinctIds.map((id) => id.toHexString()),
        title: lesson.title,
        userId: user.id,
        correlationId,
      });
    } catch (error) {
      await LessonGenerationRequest.updateOne(
        { _id: request._id, userId: user.id },
        {
          $set: {
            status: 'failed',
            lastErrorCode: 'internal_error',
            lastErrorMessage: 'The regeneration request could not be queued. Try again.',
          },
        },
      ).exec();
      throw error;
    }

    await auditEvents.generationRequested({
      userId: user.id,
      correlationId,
      metadata: {
        requestId: request._id.toHexString(),
        lessonId: lesson._id.toHexString(),
        materialIds: distinctIds.map((id) => id.toHexString()),
        regenerated: true,
      },
    });

    return accepted(serializeLessonGenerationRequest(request));
  },
);
