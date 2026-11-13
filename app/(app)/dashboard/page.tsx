import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  awaiting_upload: 'bg-muted text-muted-foreground',
  uploaded: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  scanning: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  queued: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
  processing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  quarantined: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  deleted: 'bg-muted text-muted-foreground',
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
        <h1 className="text-2xl font-semibold text-foreground">Your workspace</h1>
        <p className="text-sm text-muted-foreground">
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
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-foreground">Materials</h2>
            <Link href="/materials" className="text-sm font-medium text-brand-600 hover:underline">
              View all
            </Link>
          </div>
          {materialPage.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No materials yet.{' '}
              <Link href="/materials/new" className="font-medium text-brand-600 hover:underline">
                Upload your first document
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border text-sm">
              {materialPage.data.map((material) => (
                <li key={material._id.toHexString()} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/materials/${material._id.toHexString()}`}
                    className="truncate font-medium text-foreground hover:text-brand-600"
                  >
                    {material.originalFilename}
                  </Link>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[material.status] ?? 'bg-muted text-slate-700'
                    }`}
                  >
                    {material.status.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-foreground">Lessons</h2>
            <div className="flex items-center gap-3">
              <Link href="/lessons/new" className="text-sm font-medium text-brand-600 hover:underline">
                New lesson
              </Link>
              <Link href="/lessons" className="text-sm font-medium text-brand-600 hover:underline">
                View all
              </Link>
            </div>
          </div>
          {lessonPage.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No lessons yet — create one from your processed materials.{' '}
              <Link href="/lessons/new" className="font-medium text-brand-600 hover:underline">
                New lesson
              </Link>
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border text-sm">
              {lessonPage.data.map((lesson) => (
                <li key={lesson._id.toHexString()} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/lessons/${lesson._id.toHexString()}`}
                    className="truncate font-medium text-foreground hover:text-brand-600"
                  >
                    {lesson.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">v{lesson.version}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
