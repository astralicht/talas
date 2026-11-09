import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { LessonRevisionRepository } from '@/lib/db/repositories/lesson-revision-repository';
import { LessonEditor } from '@/components/editor/lesson-editor';
import { DeleteLessonDialog } from '@/components/lessons/delete-lesson-dialog';
import type { RevisionSummary } from '@/components/editor/revision-history';

export const metadata: Metadata = { title: 'Edit lesson' };
export const dynamic = 'force-dynamic';

export default async function LessonEditorPage({
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

  const revisionRepository = new LessonRevisionRepository(user.id);
  const revisions = await revisionRepository.listForLesson(lesson._id, { limit: 50 });

  const revisionSummaries: RevisionSummary[] = revisions.map((revision) => ({
    id: revision._id.toHexString(),
    version: revision.version,
    authorType: revision.authorType,
    createdAt: revision.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/lessons/${lessonId}`}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            ← Back to lesson
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Edit lesson</h1>
        </div>
        <DeleteLessonDialog lessonId={lessonId} />
      </div>

      <LessonEditor
        lessonId={lessonId}
        initialTitle={lesson.title}
        initialContentMarkdown={lesson.contentMarkdown}
        initialVersion={lesson.version}
        initialRevisions={revisionSummaries}
      />
    </div>
  );
}
