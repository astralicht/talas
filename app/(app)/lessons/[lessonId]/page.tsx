import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { MarkdownRenderer } from '@/components/lessons/markdown-renderer';
import { DeleteLessonDialog } from '@/components/lessons/delete-lesson-dialog';
import { RegenerateLessonDialog } from '@/components/lessons/regenerate-lesson-dialog';
import { LessonQuiz, type LessonQuizQuestion } from '@/components/lessons/lesson-quiz';

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
  const [primaryMaterial, readyMaterials] = await Promise.all([
    lesson.materialId
      ? materials.findOwnedById(lesson.materialId.toHexString())
      : Promise.resolve(null),
    materials.list({ status: 'ready' }, { limit: 100, sort: { updatedAt: -1 } }),
  ]);
  const materialDownload =
    primaryMaterial && DOWNLOADABLE_STATUSES.has(primaryMaterial.status);
  const currentSourceIds = lesson.sourceMaterialIds.map((id) => id.toHexString());

  return (
    <div className="space-y-6">
      <div>
        <Link href="/lessons" className="text-sm text-muted-foreground hover:text-foreground">
          ← Lessons
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold break-words text-foreground">{lesson.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
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
                href={`/api/materials/${primaryMaterial!._id.toHexString()}/download`}
                className="rounded-md border border-input bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background"
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
            <RegenerateLessonDialog
              lessonId={lessonId}
              version={lesson.version}
              currentSourceIds={currentSourceIds}
              readyMaterials={readyMaterials.map((entry) => ({
                id: entry._id.toHexString(),
                originalFilename: entry.originalFilename,
              }))}
            />
            <DeleteLessonDialog lessonId={lessonId} />
          </div>
        </div>
      </div>

      {currentSourceIds.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Built from{' '}
          {readyMaterials
            .filter((entry) => currentSourceIds.includes(entry._id.toHexString()))
            .map((entry, index) => (
              <span key={entry._id.toHexString()}>
                {index > 0 ? ', ' : ''}
                <Link
                  href={`/materials/${entry._id.toHexString()}`}
                  className="text-brand-600 font-medium hover:underline"
                >
                  {entry.originalFilename}
                </Link>
              </span>
            ))}
        </p>
      ) : null}

      <article className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <MarkdownRenderer content={lesson.contentMarkdown} />
      </article>

      {lesson.quiz && lesson.quiz.length > 0 ? (
        <LessonQuiz
          questions={lesson.quiz.map((question): LessonQuizQuestion => ({
            question: question.question,
            options: [...question.options],
            correctIndex: question.correctIndex,
            explanation: question.explanation ?? undefined,
          }))}
        />
      ) : null}
    </div>
  );
}
