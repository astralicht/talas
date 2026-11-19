import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BookOpen, FolderOpen } from 'lucide-react';
import { getSessionUser } from '@/lib/auth/session';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { Sparkle } from '@/components/ui/logo';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  awaiting_upload: 'bg-muted text-muted-foreground',
  uploaded: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  scanning: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  queued: 'bg-accent-100 text-accent-600 dark:bg-accent-200/20 dark:text-accent-200',
  processing: 'bg-accent-100 text-accent-600 dark:bg-accent-200/20 dark:text-accent-200',
  ready: 'bg-accent-100 text-accent-600 dark:bg-accent-200/20 dark:text-accent-200',
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
      <section className="relative space-y-2">
        <Sparkle className="absolute -top-3 right-0 h-8 w-auto opacity-80" />
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Your workspace</h1>
        <p className="text-sm text-muted-foreground">
          Everything here belongs only to {user.email}.
        </p>
        {!user.emailVerified ? (
          <p className="mt-2 rounded-full bg-brand-100 px-4 py-2 text-sm text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
            Verify your email to unlock uploads and lesson generation.{' '}
            <Link href="/verify-email" className="font-semibold underline">
              Resend the link
            </Link>
            .
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="border-border bg-card rounded-2xl border p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <FolderOpen className="text-brand-600 h-4.5 w-4.5" />
              Materials
            </h2>
            <Link href="/materials" className="text-brand-700 text-sm font-semibold hover:underline">
              View all
            </Link>
          </div>
          {materialPage.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No materials yet.{' '}
              <Link href="/materials/new" className="text-brand-700 font-semibold hover:underline">
                Upload your first document
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-border mt-3 divide-y text-sm">
              {materialPage.data.map((material) => (
                <li key={material._id.toHexString()} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/materials/${material._id.toHexString()}`}
                    className="hover:text-brand-700 truncate font-medium text-foreground"
                  >
                    {material.originalFilename}
                  </Link>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      STATUS_STYLES[material.status] ?? 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {material.status.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-border bg-card rounded-2xl border p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <BookOpen className="text-brand-600 h-4.5 w-4.5" />
              Lessons
            </h2>
            <div className="flex items-center gap-3">
              <Link href="/lessons/new" className="text-brand-700 text-sm font-semibold hover:underline">
                New lesson
              </Link>
              <Link href="/lessons" className="text-brand-700 text-sm font-semibold hover:underline">
                View all
              </Link>
            </div>
          </div>
          {lessonPage.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No lessons yet — create one from your processed materials.{' '}
              <Link href="/lessons/new" className="text-brand-700 font-semibold hover:underline">
                New lesson
              </Link>
            </p>
          ) : (
            <ul className="divide-border mt-3 divide-y text-sm">
              {lessonPage.data.map((lesson) => (
                <li key={lesson._id.toHexString()} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/lessons/${lesson._id.toHexString()}`}
                    className="hover:text-brand-700 truncate font-medium text-foreground"
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
