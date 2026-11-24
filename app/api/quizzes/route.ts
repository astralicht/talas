import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { created, json } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { Quiz, type IQuiz } from '@/lib/db/models/quiz';
import { Lesson } from '@/lib/db/models/lesson';
import { serializeQuiz } from '@/lib/http/serializers';
import { enqueueQuizGenerationJob } from '@/lib/jobs/queues';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit';
import { PLAN_FAILURE_CODES } from '@/lib/plans';
import { countUserQuizzes, userPlanContext } from '@/lib/plans/usage';
import { reserveLessonGeneration, refundLessonGeneration } from '@/lib/plans/allowance';
import { auditEvents } from '@/lib/logging/audit-events';
import { createQuizSchema } from '@/lib/validation/quizzes';
import { paginationSchema } from '@/lib/validation/common';

export const dynamic = 'force-dynamic';

const listQuerySchema = paginationSchema;

/**
 * Explicit quiz-generation requests (TODO step 14). The request row is created
 * `queued` and the generation worker fans out over 1-7 ready lessons in
 * batches; progress is polled through GET /api/quizzes/{id}.
 *
 * Plan limits (constitution amendment): the quiz storage quota is checked
 * first, then the per-quiz source cap (3 free / 7 plus), then one
 * daily-generation point is reserved atomically — a terminal worker failure
 * refunds it, so failed attempts never consume the allowance.
 */
export const POST = route(
  { auth: true, verified: true, csrf: true, body: createQuizSchema },
  async ({ user, body, correlationId }) => {
    if (!user) throw new Error('Authenticated user missing from request context');

    await enforceRateLimit(`generate:user:${user.id}`, RATE_LIMITS.GENERATE_HOURLY);

    const { limits } = await userPlanContext(user.id);

    const requestedIds = body.lessonIds.map((id) => new Types.ObjectId(id));
    // Distinctness is validated by the body schema; de-dupe defensively anyway.
    const distinctIds = requestedIds.filter(
      (id, index) => requestedIds.findIndex((other) => other.equals(id)) === index,
    );

    if (distinctIds.length > limits.maxQuizSources) {
      throw errors.planLimit(
        `Your ${user.plan} plan draws quizzes from up to ${limits.maxQuizSources} lesson${
          limits.maxQuizSources === 1 ? '' : 's'
        } per quiz (selected ${distinctIds.length}). Drop a lesson or upgrade your plan.`,
        {
          reason: PLAN_FAILURE_CODES.quizSources,
          used: distinctIds.length,
          limit: limits.maxQuizSources,
        },
      );
    }

    const readyLessons = await Lesson.find({
      _id: { $in: distinctIds },
      userId: user.id,
      status: 'ready',
    })
      .select('_id')
      .lean()
      .exec();
    if (readyLessons.length !== distinctIds.length) {
      // Same reply for foreign, missing, and not-ready lessons.
      throw errors.notFound();
    }

    const quizzesUsed = await countUserQuizzes(user.id);
    if (quizzesUsed >= limits.quizzes) {
      throw errors.planLimit(
        `Your ${user.plan} plan stores up to ${limits.quizzes} quiz${
          limits.quizzes === 1 ? '' : 'zes'
        } and all slots are in use. Delete a quiz to free a slot, or upgrade your plan.`,
        {
          reason: PLAN_FAILURE_CODES.quizzes,
          used: quizzesUsed,
          limit: limits.quizzes,
        },
      );
    }

    const reservation = await reserveLessonGeneration(user.id, limits.dailyLessonGenerations);
    if (!reservation.reserved) {
      throw errors.planLimit(
        `You have used all ${limits.dailyLessonGenerations} generation${
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

    let quiz: IQuiz | undefined;
    try {
      const [createdQuiz] = await Quiz.create([
        {
          userId: user.id,
          title: body.title,
          itemCount: body.itemCount,
          sourceLessonIds: distinctIds,
          status: 'queued',
        },
      ]);
      if (!createdQuiz) throw new Error('Quiz could not be created');
      quiz = createdQuiz;

      await enqueueQuizGenerationJob({
        type: 'generate_quiz',
        quizId: quiz._id.toHexString(),
        userId: user.id,
        correlationId,
      });
    } catch (error) {
      if (quiz) {
        await Quiz.updateOne(
          { _id: quiz._id, userId: user.id },
          {
            $set: {
              status: 'failed',
              leaseUntil: null,
              lastErrorCode: 'internal_error',
              lastErrorMessage: 'The quiz could not be queued. Try again.',
            },
          },
        ).exec();
      }
      // The reservation is dead: no job will ever settle this quiz.
      await refundLessonGeneration(user.id);
      throw error;
    }
    if (!quiz) throw new Error('Quiz could not be created');

    await auditEvents.quizRequested({
      userId: user.id,
      correlationId,
      metadata: {
        quizId: quiz._id.toHexString(),
        lessonIds: distinctIds.map((id) => id.toHexString()),
        itemCount: body.itemCount,
      },
    });

    return created(serializeQuiz(quiz));
  },
);

export const GET = route({ auth: true, query: listQuerySchema }, async ({ user, query }) => {
  if (!user) throw new Error('Authenticated user missing from request context');
  const filter = { userId: user.id };
  const [quizzes, total] = await Promise.all([
    Quiz.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean()
      .exec(),
    Quiz.countDocuments(filter).exec(),
  ]);
  return json({
    data: (quizzes as unknown as IQuiz[]).map(serializeQuiz),
    page: query.page,
    limit: query.limit,
    total,
  });
});
