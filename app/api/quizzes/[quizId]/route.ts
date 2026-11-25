import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { json, noContent } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { Quiz } from '@/lib/db/models/quiz';
import {
  serializeQuiz,
  serializeQuizAttemptResults,
  serializeQuizReady,
} from '@/lib/http/serializers';
import { quizAttemptQuerySchema, quizIdParamsSchema } from '@/lib/validation/quizzes';

export const dynamic = 'force-dynamic';

/**
 * Quiz view, three modes (TODO step 16):
 * - queued/processing: progress only.
 * - ready, never attempted: the interactive view — questions WITHOUT the
 *   answer key (it stays in the database until a submission).
 * - attempted: the results view for the requested attempt (default: the
 *   latest) — your picks, the correct options, and the explanations, plus the
 *   score history across retakes. Foreign ids answer the same non-revealing
 *   404 as a missing quiz.
 */
export const GET = route(
  { auth: true, params: quizIdParamsSchema, query: quizAttemptQuerySchema },
  async ({ user, params, query }) => {
    if (!user) throw new Error('Authenticated user missing from request context');
    const quiz = await Quiz.findOne({
      _id: new Types.ObjectId(params.quizId),
      userId: user.id,
    })
      .lean()
      .exec();
    if (!quiz) throw errors.notFound();
    const typed = quiz as unknown as Parameters<typeof serializeQuiz>[0];

    // Pre-step-16 rows may lack the attempts array entirely (lean reads skip
    // schema defaults) — guard everywhere.
    const attempts = typed.attempts ?? [];
    if (typed.status !== 'ready') return json(serializeQuiz(typed));
    if (attempts.length === 0) return json(serializeQuizReady({ ...typed, attempts: [] }));

    const requested = query.attempt ?? attempts.length;
    const attemptIndex = Math.min(Math.max(requested - 1, 0), attempts.length - 1);
    return json(serializeQuizAttemptResults({ ...typed, attempts }, attemptIndex));
  },
);

/**
 * Deletes a quiz in any state (a racing worker simply writes to nothing).
 * Deleting frees the plan's quiz-storage slot immediately, along with every
 * stored attempt.
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
