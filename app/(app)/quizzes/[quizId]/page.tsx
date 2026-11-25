import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Types } from 'mongoose';
import { getSessionUser } from '@/lib/auth/session';
import { Quiz } from '@/lib/db/models/quiz';
import { serializeQuizAttemptResults } from '@/lib/http/serializers';
import { QuizPoller } from '@/components/quizzes/quiz-poller';
import { QuizExperience } from '@/components/quizzes/quiz-experience';

export const metadata: Metadata = { title: 'Quiz' };
export const dynamic = 'force-dynamic';

export default async function QuizViewPage({
  params,
}: {
  params: Promise<{ quizId: string }>;
}) {
  const { quizId } = await params;
  if (!/^[a-f0-9]{24}$/.test(quizId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect('/login');

  const quiz = await Quiz.findOne({
    _id: new Types.ObjectId(quizId),
    userId: user.id,
  })
    .lean()
    .exec();
  if (!quiz) notFound();

  const created = quiz.createdAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/quizzes" className="text-muted-foreground hover:text-foreground text-sm">
          ← Quizzes
        </Link>
        <h1 className="text-foreground mt-2 text-2xl font-extrabold tracking-tight break-words">
          {quiz.title}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {quiz.itemCount} items · {quiz.sourceLessonIds.length} lesson
          {quiz.sourceLessonIds.length === 1 ? '' : 's'} · {created}
        </p>
      </div>

      {quiz.status !== 'ready' ? (
        <QuizPoller quizId={quiz._id.toHexString()} />
      ) : (
        <QuizExperience
          quizId={quiz._id.toHexString()}
          itemCount={quiz.itemCount}
          questions={(quiz.questions ?? []).map((question) => ({
            question: question.question,
            options: [...question.options],
          }))}
          attempts={(quiz.attempts ?? []).map((attempt, index) => ({
            attemptNumber: index + 1,
            scoreCorrect: attempt.scoreCorrect,
            scoreTotal: attempt.scoreTotal,
            submittedAt: attempt.submittedAt.toISOString(),
          }))}
          latestResults={
            (quiz.attempts ?? []).length > 0
              ? serializeQuizAttemptResults({ ...quiz, attempts: quiz.attempts ?? [] }, (quiz.attempts ?? []).length - 1)
              : null
          }
        />
      )}
    </div>
  );
}
