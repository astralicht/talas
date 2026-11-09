import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { MarkdownRenderer } from '@/components/lessons/markdown-renderer';
import { DeleteLessonDialog } from '@/components/lessons/delete-lesson-dialog';

export const metadata: Metadata = { title: 'Lesson' };
export const dynamic = 'force-dynamic';

const DOWNLOADABLE_STATUSES: ReadonlySet<string> = new Set([
  'awaiting_upload',
  'uploaded',
  'scanning',
  'queued',
  'processing',
  'ready',
  'failed',
]);

export default async function LessonViewPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  if (!/^[a-f0-9]{24}$/.test(lessonId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect('/login');

  const lessons = new LessonRepository(user.id);
  const lesson = await lessons.findOwnedById(lessonId);
  if (!lesson) notFound();

  const materials = new MaterialRepository(user.id);
  const material = lesson.materialId
    ? await materials.findOwnedById(lesson.materialId.toHexString())
    : null;
  const materialDownload = material && DOWNLOADABLE_STATUSES.has(material.status);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/lessons" className="text-sm text-slate-600 hover:text-slate-900">
          ← Lessons
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold break-words text-slate-900">{lesson.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Version {lesson.version}
              {lesson.updatedAt
                ? ` · updated ${lesson.updatedAt.toLocaleString('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}`
                : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {materialDownload ? (
              <a
                href={`/api/materials/${material._id.toHexString()}/download`}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                data-testid="download-material"
              >
                Download original material
              </a>
            ) : null}
            <Link
              href={`/lessons/${lessonId}/edit`}
              className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white"
              data-testid="edit-lesson"
            >
              Edit lesson
            </Link>
            <DeleteLessonDialog lessonId={lessonId} />
          </div>
        </div>
      </div>

      {material ? (
        <p className="text-sm text-slate-600">
          Source material:{' '}
          <Link
            href={`/materials/${material._id.toHexString()}`}
            className="text-brand-600 font-medium hover:underline"
          >
            {material.originalFilename}
          </Link>
        </p>
      ) : null}

      <article className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <MarkdownRenderer content={lesson.contentMarkdown} />
      </article>
    </div>
  );
}
