import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Types } from 'mongoose';
import { getSessionUser } from '@/lib/auth/session';
import { Quiz } from '@/lib/db/models/quiz';
import { QuizPoller } from '@/components/quizzes/quiz-poller';

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
        <QuizPoller quizId={quiz._id.toHexString()} initialStatus={quiz.status} />
      ) : quiz.questions.length === 0 ? (
        <div className="border-border bg-card rounded-2xl border p-8 text-center">
          <p className="text-foreground font-medium">This quiz is empty</p>
          <p className="text-muted-foreground mt-1 text-sm">Generate a new quiz to replace it.</p>
        </div>
      ) : (
        <ol className="space-y-4">
          {quiz.questions.map((question, index) => (
            <li
              key={`${index}-${question.question.slice(0, 16)}`}
              className="border-border bg-card rounded-2xl border p-5"
              data-testid="quiz-question"
            >
              <p className="text-foreground font-semibold">
                {index + 1}. {question.question}
              </p>
              <ol className="mt-3 space-y-1.5">
                {question.options.map((option, optionIndex) => (
                  <li key={optionIndex} className="text-muted-foreground flex gap-2 text-sm">
                    <span className="text-foreground font-medium">
                      {String.fromCharCode(65 + optionIndex)}.
                    </span>
                    <span>{option}</span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
