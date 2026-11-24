import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { Quiz, type IQuiz } from '@/lib/db/models/quiz';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Quizzes' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<IQuiz['status'], { label: string; className: string }> = {
  queued: {
    label: 'Queued',
    className: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  },
  processing: {
    label: 'Generating',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  ready: {
    label: 'Ready',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  },
};

export default async function QuizzesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const userId = user.id;

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? '1') || 1);

  const quizzes = await Quiz.find({ userId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .lean<IQuiz[]>()
    .exec();
  const total = await Quiz.countDocuments({ userId }).exec();
  const hasNext = page * PAGE_SIZE < total;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Quizzes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Long practice quizzes built from your finished lessons.
          </p>
        </div>
        <Link href="/quizzes/new" className={buttonVariants({ variant: 'primary', size: 'sm' })} data-testid="new-quiz">
          New quiz
        </Link>
      </div>

      {quizzes.length === 0 ? (
        <div className="border-border bg-card rounded-2xl border p-8 text-center">
          <p className="text-foreground font-medium">No quizzes yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Generate a 20, 30, or 50-item quiz from one or more of your lessons.
          </p>
          <Link href="/quizzes/new" className={`${buttonVariants({ variant: 'primary', size: 'sm' })} mt-4`}>
            Generate your first quiz
          </Link>
        </div>
      ) : (
        <ul className="border-border bg-card divide-border divide-y rounded-2xl border">
          {quizzes.map((quiz) => {
            const badge = STATUS_LABELS[quiz.status];
            return (
              <li key={quiz._id.toHexString()} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/quizzes/${quiz._id.toHexString()}`}
                    className="text-foreground truncate font-semibold hover:underline"
                  >
                    {quiz.title}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {quiz.itemCount} items · {quiz.sourceLessonIds.length} lesson
                    {quiz.sourceLessonIds.length === 1 ? '' : 's'} ·{' '}
                    {quiz.createdAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                  {quiz.status === 'failed' && quiz.lastErrorMessage ? (
                    <p className="mt-1 text-xs text-red-700 dark:text-red-300">{quiz.lastErrorMessage}</p>
                  ) : null}
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
                  {badge.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {total > PAGE_SIZE ? (
        <div className="text-muted-foreground flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={`/quizzes?page=${page - 1}`} className="hover:text-foreground">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span>
            Page {page}
            {hasNext ? (
              <Link href={`/quizzes?page=${page + 1}`} className="text-brand-700 ml-3 hover:underline">
                Older →
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
