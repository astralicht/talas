import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { accepted } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { Material } from '@/lib/db/models/material';
import {
  LessonGenerationRequest,
  type ILessonGenerationRequest,
} from '@/lib/db/models/lesson-generation-request';
import { enqueueLessonGenerationJob } from '@/lib/jobs/queues';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { planLimitsFor, PLAN_FAILURE_CODES } from '@/lib/plans';
import { countUserLessons } from '@/lib/plans/usage';
import { reserveLessonGeneration, refundLessonGeneration } from '@/lib/plans/allowance';
import { serializeLessonGenerationRequest } from '@/lib/http/serializers';
import { auditEvents } from '@/lib/logging/audit-events';
import { generateLessonRequestSchema } from '@/lib/validation/lessons';

export const dynamic = 'force-dynamic';

/**
 * Requests a new lesson from 1-5 ready source materials (specs/005). The row is
 * created `queued` and the generation worker fans out over the sources; progress
 * is polled through GET /api/lesson-requests/{id}. Foreign or not-ready
 * materials answer with the same non-revealing 404 as a missing material.
 *
 * Plan limits (constitution v2.3.0): the lesson storage quota is checked first,
 * then one daily-generation point is reserved atomically — a terminal worker
 * failure refunds it, so failed attempts never consume the allowance.
 * Regeneration never reserves (exempt).
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

    const limits = planLimitsFor(user.plan);
    const lessonsUsed = await countUserLessons(user.id);
    if (lessonsUsed >= limits.lessons) {
      throw errors.planLimit(
        `Your ${user.plan} plan stores up to ${limits.lessons} lesson${
          limits.lessons === 1 ? '' : 's'
        } and all slots are in use. Delete a lesson to free a slot, or upgrade your plan.`,
        { reason: PLAN_FAILURE_CODES.lessons, used: lessonsUsed, limit: limits.lessons },
      );
    }

    const reservation = await reserveLessonGeneration(user.id, limits.dailyLessonGenerations);
    if (!reservation.reserved) {
      throw errors.planLimit(
        `You have used all ${limits.dailyLessonGenerations} lesson generation${
          limits.dailyLessonGenerations === 1 ? '' : 's'
        } allowed today on the ${user.plan} plan. The allowance resets at UTC midnight.`,
        {
          reason: PLAN_FAILURE_CODES.generations,
          used: reservation.used,
          limit: limits.dailyLessonGenerations,
          resetsAt: reservation.resetsAt.toISOString(),
        },
      );
    }

    let request: ILessonGenerationRequest | undefined;
    try {
      const [created] = await LessonGenerationRequest.create([
        {
          userId: user.id,
          title: body.title,
          materialIds: distinctIds,
          status: 'queued',
        },
      ]);
      if (!created) throw new Error('Generation request could not be created');
      request = created;

      await enqueueLessonGenerationJob({
        type: 'generate_lesson_request',
        requestId: request._id.toHexString(),
        materialIds: distinctIds.map((id) => id.toHexString()),
        title: body.title,
        userId: user.id,
        correlationId,
      });
    } catch (error) {
      if (request) {
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
      }
      // The reservation is dead: no job will ever settle this request.
      await refundLessonGeneration(user.id);
      throw error;
    }
    if (!request) throw new Error('Generation request could not be created');

    await auditEvents.generationRequested({
      userId: user.id,
      correlationId,
      metadata: {
        requestId: request._id.toHexString(),        materialIds: distinctIds.map((id) => id.toHexString()),
        titleLength: body.title.length,
      },
    });

    return accepted(serializeLessonGenerationRequest(request));
  },
);
