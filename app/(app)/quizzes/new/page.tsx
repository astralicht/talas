import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { Lesson } from '@/lib/db/models/lesson';
import { QUIZ_ITEM_COUNTS } from '@/lib/db/models/quiz';
import { planLimitsFor } from '@/lib/plans';
import { NewQuizForm } from '@/components/quizzes/new-quiz-form';

export const metadata: Metadata = { title: 'New quiz' };
export const dynamic = 'force-dynamic';

export default async function NewQuizPage({
  searchParams,
}: {
  searchParams: Promise<{ lesson?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const { lesson } = await searchParams;
  const limits = planLimitsFor(user.plan);
  const ready = await Lesson.find({ userId: user.id, status: 'ready' })
    .sort({ updatedAt: -1 })
    .limit(100)
    .select('title')
    .lean<{ _id: { toHexString(): string }; title: string }[]>()
    .exec();

  const preselectedIds = lesson && /^[a-f0-9]{24}$/.test(lesson) ? [lesson] : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/quizzes" className="text-muted-foreground hover:text-foreground text-sm">
          ← Quizzes
        </Link>
        <h1 className="text-foreground mt-2 text-2xl font-extrabold tracking-tight">New quiz</h1>
        <p className="text-muted-foreground text-sm">
          Pick the finished lessons it should draw from — a{' '}
          {limits.maxQuizSources}-lesson limit applies on the {user.plan} plan.
        </p>
      </div>

      <section className="border-border bg-card rounded-2xl border p-6">
        <NewQuizForm
          lessons={ready.map((entry) => ({
            id: entry._id.toHexString(),
            title: entry.title,
          }))}
          preselectedIds={preselectedIds}
          itemCounts={[...QUIZ_ITEM_COUNTS]}
          maxSources={limits.maxQuizSources}
        />
      </section>
    </div>
  );
}
