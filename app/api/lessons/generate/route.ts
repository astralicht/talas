import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { accepted } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { Material } from '@/lib/db/models/material';
import { LessonGenerationRequest } from '@/lib/db/models/lesson-generation-request';
import { enqueueLessonGenerationJob } from '@/lib/jobs/queues';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { serializeLessonGenerationRequest } from '@/lib/http/serializers';
import { auditEvents } from '@/lib/logging/audit-events';
import { generateLessonRequestSchema } from '@/lib/validation/lessons';

export const dynamic = 'force-dynamic';

/**
 * Requests a new lesson from 1-5 ready source materials (specs/005). The row is
 * created `queued` and the generation worker fans out over the sources; progress
 * is polled through GET /api/lesson-requests/{id}. Foreign or not-ready
 * materials answer with the same non-revealing 404 as a missing material.
 */
export const POST = route(
  { auth: true, verified: true, csrf: true, body: generateLessonRequestSchema },
  async ({ user, body, correlationId }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    await enforceRateLimit(`generate:user:${user.id}`, RATE_LIMITS.GENERATE_HOURLY);

    const requestedIds = body.materialIds.map((id) => new Types.ObjectId(id));
    // Distinctness is validated by the body schema; de-dupe defensively anyway.
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
      // Same reply for foreign, missing, and not-yet-ready materials.
      throw errors.notFound();
    }

    const [request] = await LessonGenerationRequest.create([
      {
        userId: user.id,
        title: body.title,
        materialIds: distinctIds,
        status: 'queued',
      },
    ]);
    if (!request) throw new Error('Generation request could not be created');

    try {
      await enqueueLessonGenerationJob({
        type: 'generate_lesson_request',
        requestId: request._id.toHexString(),
        materialIds: distinctIds.map((id) => id.toHexString()),
        title: body.title,
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
            lastErrorMessage: 'The generation request could not be queued. Try again.',
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
        materialIds: distinctIds.map((id) => id.toHexString()),
        titleLength: body.title.length,
      },
    });

    return accepted(serializeLessonGenerationRequest(request));
  },
);
