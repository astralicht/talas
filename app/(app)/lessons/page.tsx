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
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Lessons</h1>
        <p className="text-sm text-slate-600">Generated and edited study lessons, newest first.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        {data.length === 0 ? (
          <p className="text-sm text-slate-600">
            Lessons appear here after a material finishes processing.{' '}
            <Link href="/materials/new" className="font-medium text-brand-600 hover:underline">
              Upload a document
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((lessonDoc) => {
              const lesson = serializeLessonSummary(lessonDoc);
              return (
                <li key={lesson.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/lessons/${lesson.id}`}
                      className="block truncate font-medium text-slate-800 hover:text-brand-600"
                    >
                      {lesson.title}
                    </Link>
                    <p className="text-xs text-slate-500">
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
