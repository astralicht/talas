import { Types } from 'mongoose';
import { route } from '@/lib/http/handler';
import { created } from '@/lib/http/responses';
import { errors } from '@/lib/http/errors';
import { Quiz } from '@/lib/db/models/quiz';
import { serializeQuizAttemptResults } from '@/lib/http/serializers';
import { gradeAttempt } from '@/lib/quizzes/grading';
import { quizIdParamsSchema, submitQuizSchema } from '@/lib/validation/quizzes';

export const dynamic = 'force-dynamic';

/**
 * Submits one attempt (TODO step 16): graded server-side — the answer key
 * never leaves the database before the user commits their picks. Unlimited
 * retakes: every submission appends an attempt; skipped questions (-1) score
 * zero. No allowance cost (grading is local).
 */
export const POST = route(
  { auth: true, csrf: true, params: quizIdParamsSchema, body: submitQuizSchema },
  async ({ user, params, body }) => {
    if (!user) throw new Error('Authenticated user missing from request context');
    const quiz = await Quiz.findOne({
      _id: new Types.ObjectId(params.quizId),
      userId: user.id,
    }).exec();
    if (!quiz) throw errors.notFound();
    if (quiz.status !== 'ready') {
      throw errors.conflict('The quiz is still being generated. Try again when it is ready.');
    }
    if (body.answers.length !== quiz.itemCount) {
      throw errors.validation(
        undefined,
        `The submission must carry exactly ${quiz.itemCount} answers (one per question), all answered.`,
      );
    }

    const graded = gradeAttempt(quiz.questions, body.answers);
    quiz.attempts.push({
      answers: graded.answers,
      scoreCorrect: graded.scoreCorrect,
      scoreTotal: graded.scoreTotal,
      submittedAt: new Date(),
    });
    await quiz.save();

    const attemptIndex = quiz.attempts.length - 1;
    return created(serializeQuizAttemptResults(quiz, attemptIndex));
  },
);
