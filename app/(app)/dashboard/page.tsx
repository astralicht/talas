import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  awaiting_upload: 'bg-slate-100 text-slate-700',
  uploaded: 'bg-sky-100 text-sky-800',
  scanning: 'bg-sky-100 text-sky-800',
  queued: 'bg-indigo-100 text-indigo-800',
  processing: 'bg-indigo-100 text-indigo-800',
  ready: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  quarantined: 'bg-red-100 text-red-800',
  deleted: 'bg-slate-100 text-slate-500',
};

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const materials = new MaterialRepository(user.id);
  const lessons = new LessonRepository(user.id);
  const [materialPage, lessonPage] = await Promise.all([
    materials.listPaged({ page: 1, limit: 5 }),
    lessons.listPaged({ page: 1, limit: 5 }),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Your workspace</h1>
        <p className="text-sm text-slate-600">
          Everything here belongs only to {user.email}.
        </p>
        {!user.emailVerified ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Verify your email to unlock uploads and lesson generation.{' '}
            <Link href="/verify-email" className="font-medium underline">
              Resend the link
            </Link>
            .
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-slate-900">Materials</h2>
            <Link href="/materials" className="text-sm font-medium text-brand-600 hover:underline">
              View all
            </Link>
          </div>
          {materialPage.data.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              No materials yet.{' '}
              <Link href="/materials/new" className="font-medium text-brand-600 hover:underline">
                Upload your first document
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {materialPage.data.map((material) => (
                <li key={material._id.toHexString()} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/materials/${material._id.toHexString()}`}
                    className="truncate font-medium text-slate-800 hover:text-brand-600"
                  >
                    {material.originalFilename}
                  </Link>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[material.status] ?? 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {material.status.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-slate-900">Lessons</h2>
            <Link href="/lessons" className="text-sm font-medium text-brand-600 hover:underline">
              View all
            </Link>
          </div>
          {lessonPage.data.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              Lessons appear here after a material finishes processing.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {lessonPage.data.map((lesson) => (
                <li key={lesson._id.toHexString()} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/lessons/${lesson._id.toHexString()}`}
                    className="truncate font-medium text-slate-800 hover:text-brand-600"
                  >
                    {lesson.title}
                  </Link>
                  <span className="shrink-0 text-xs text-slate-500">v{lesson.version}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
