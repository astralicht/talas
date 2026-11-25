import { Types } from 'mongoose';
import { getLogger } from '@/lib/logging/logger';
import { auditEvents } from '@/lib/logging/audit-events';
import { refundLessonGeneration } from '@/lib/plans/allowance';
import { Lesson } from '@/lib/db/models/lesson';
import { Quiz, QUIZ_LEASE_MS, type IQuiz } from '@/lib/db/models/quiz';
import { generateQuiz, QuizGenerationError, type GeneratedQuizQuestion, type QuizSourceLesson } from '@/lib/ai/generate-quiz';
import { SOURCE_CHAR_CAP, TOTAL_SOURCE_CHAR_CAP } from '@/lib/ai/prompts';
import type { GenerateQuizJob } from '@/lib/jobs/schemas';

const logger = getLogger().child({ service: 'talas-worker', processor: 'generate-quiz' });

const REQUEST_LEASE_MS = QUIZ_LEASE_MS;

/**
 * Explicit quiz-generation requests (TODO step 14): claims the queued quiz
 * with the same lease pattern as lesson-generation requests, then generates
 * the exact item count in batches over the source lessons' content.
 * All-or-nothing: a terminal failure marks the quiz failed and refunds the
 * daily-generation point reserved at admission.
 */
export async function processGenerateQuiz(payload: GenerateQuizJob): Promise<void> {
  const { quizId, userId, correlationId } = payload;
  const userObjectId = new Types.ObjectId(userId);

  const failQuiz = async (
    claimed: IQuiz,
    code: string,
    message: string,
    detail?: unknown,
  ): Promise<void> => {
    // Terminal failures leave no row behind (TODO step 15): the quiz is
    // deleted, never listed, and its storage slot frees immediately. The
    // reason lives in the audit event; the allowance point is refunded.
    await Quiz.deleteOne({ _id: claimed._id, userId: userObjectId }).exec();
    await auditEvents.quizFailed({
      userId,
      correlationId,
      metadata: { quizId, code, message },
    });
    try {
      await refundLessonGeneration(userId);
    } catch (refundError) {
      logger.warn({ err: refundError }, 'Allowance refund failed');
    }
    logger.info({ quizId, code }, 'Quiz generation request failed');
    if (detail) logger.warn({ err: detail, quizId, code }, 'Quiz generation failure detail');
  };

  const now = new Date();
  const claimed = await Quiz.findOneAndUpdate(
    {
      _id: new Types.ObjectId(quizId),
      userId: userObjectId,
      $or: [{ status: 'queued' }, { status: 'processing', leaseUntil: { $lte: now } }],
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
    const existing = await Quiz.findOne({ _id: new Types.ObjectId(quizId), userId: userObjectId }).exec();
    if (existing?.status === 'ready') {
      logger.info({ quizId }, 'Quiz already ready; redelivered job reconciled');
      return;
    }
    logger.warn({ quizId, status: existing?.status }, 'Quiz not claimable');
    return;
  }

  const lessons = await Lesson.find({
    _id: { $in: claimed.sourceLessonIds },
    userId: userObjectId,
    status: 'ready',
  })
    .select('title contentMarkdown')
    .lean<{ _id: { toHexString(): string }; title: string; contentMarkdown: string }[]>()
    .exec();
  if (lessons.length !== claimed.sourceLessonIds.length) {
    await failQuiz(claimed, 'lesson_unavailable', 'A source lesson is not available for quizzing right now.');
    return;
  }

  const sources: QuizSourceLesson[] = [];
  let used = 0;
  for (const lesson of lessons) {
    const capped = lesson.contentMarkdown.slice(
      0,
      Math.max(0, Math.min(SOURCE_CHAR_CAP, TOTAL_SOURCE_CHAR_CAP - used)),
    );
    used += capped.length;
    sources.push({ lessonId: lesson._id.toHexString(), title: lesson.title, contentMarkdown: capped });
  }

  try {
    const generated = await generateQuiz({
      userId,
      itemCount: claimed.itemCount,
      lessons: sources,
    });

    // Attribution: the model names the source lesson by title; map back to ids.
    const idByTitle = new Map(sources.map((lesson) => [lesson.title, lesson.lessonId]));
    const questions: GeneratedQuizQuestion[] = generated.questions.map((question) => ({
      ...question,
      sourceLessonId: question.sourceLessonTitle
        ? new Types.ObjectId(idByTitle.get(question.sourceLessonTitle) ?? question.sourceLessonTitle)
        : null,
    }));

    const saved = await Quiz.updateOne(
      { _id: claimed._id, userId: userObjectId, status: 'processing' },
      {
        $set: {
          status: 'ready',
          questions,
          leaseUntil: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      },
    ).exec();
    if (saved.matchedCount === 0) {
      logger.warn({ quizId }, 'Quiz disappeared mid-generation; results discarded');
      return;
    }

    await auditEvents.quizSucceeded({
      userId,
      correlationId,
      metadata: { quizId, itemCount: claimed.itemCount, provider: generated.provider, model: generated.model },
    });
    logger.info({ quizId, itemCount: claimed.itemCount, provider: generated.provider }, 'Quiz generation completed');
  } catch (error) {
    if (error instanceof QuizGenerationError) {
      await failQuiz(claimed, error.code, 'The quiz could not be generated. Try again.', error);
      return;
    }
    await failQuiz(claimed, 'internal_error', 'The quiz could not be generated. Try again.', error);
  }
}
