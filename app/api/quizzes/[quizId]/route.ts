import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { json, noContent } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { Quiz } from '@/lib/db/models/quiz';
import { serializeQuiz, serializeQuizReady } from '@/lib/http/serializers';
import { quizIdParamsSchema } from '@/lib/validation/quizzes';

export const dynamic = 'force-dynamic';

/**
 * Quiz progress + result. While queued/processing the view carries the status
 * and the last error; when ready it carries the questions — without the
 * answer key, which stays server-side until a later step adds
 * reveal/scored modes (TODO step 14). Foreign ids answer the same
 * non-revealing 404 as a missing quiz.
 */
export const GET = route(
  { auth: true, params: quizIdParamsSchema },
  async ({ user, params }) => {
    if (!user) throw new Error('Authenticated user missing from request context');
    const quiz = await Quiz.findOne({
      _id: new Types.ObjectId(params.quizId),
      userId: user.id,
    })
      .lean()
      .exec();
    if (!quiz) throw errors.notFound();
    const typed = quiz as unknown as Parameters<typeof serializeQuiz>[0];
    return json(quiz.status === 'ready' ? serializeQuizReady(typed) : serializeQuiz(typed));
  },
);

/**
 * Deletes a quiz in any state (a racing worker simply writes to nothing).
 * Deleting frees the plan's quiz-storage slot immediately.
 */
export const DELETE = route(
  { auth: true, csrf: true, params: quizIdParamsSchema },
  async ({ user, params }) => {
    if (!user) throw new Error('Authenticated user missing from request context');
    const result = await Quiz.deleteOne({
      _id: new Types.ObjectId(params.quizId),
      userId: user.id,
    }).exec();
    if (result.deletedCount === 0) throw errors.notFound();
    return noContent();
  },
);
