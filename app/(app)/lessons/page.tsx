import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { serializeLessonSummary } from '@/lib/http/serializers';

export const metadata: Metadata = { title: 'Lessons' };
export const dynamic = 'force-dynamic';

export default async function LessonsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const repository = new LessonRepository(user.id);
  const { data } = await repository.listPaged({ page: 1, limit: 50 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Lessons</h1>
          <p className="text-sm text-muted-foreground">Generated and edited study lessons, newest first.</p>
        </div>
        <Link
          href="/lessons/new"
          className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white"
        >
          New lesson
        </Link>
      </div>

      <section className="rounded-xl border border-border bg-card p-6">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lessons yet — create one from your processed materials.{' '}
            <Link href="/lessons/new" className="font-medium text-brand-600 hover:underline">
              New lesson
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.map((lessonDoc) => {
              const lesson = serializeLessonSummary(lessonDoc);
              return (
                <li key={lesson.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/lessons/${lesson.id}`}
                      data-testid="lesson-link"
                      className="block truncate font-medium text-foreground hover:text-brand-600"
                    >
                      {lesson.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Version {lesson.version} · updated {new Date(lesson.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
