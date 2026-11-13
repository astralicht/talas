import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { NewLessonForm } from '@/components/lessons/new-lesson-form';

export const metadata: Metadata = { title: 'New lesson' };
export const dynamic = 'force-dynamic';

export default async function NewLessonPage({
  searchParams,
}: {
  searchParams: Promise<{ material?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const { material } = await searchParams;
  const materials = new MaterialRepository(user.id);
  const ready = await materials.list({ status: 'ready' }, { limit: 100, sort: { updatedAt: -1 } });

  const preselectedIds = material && /^[a-f0-9]{24}$/.test(material) ? [material] : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/lessons" className="text-sm text-slate-600 hover:text-slate-900">
          ← Lessons
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">New lesson</h1>
        <p className="text-sm text-slate-600">
          Name the lesson and pick the processed documents it should build on.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <NewLessonForm
          materials={ready.map((entry) => ({
            id: entry._id.toHexString(),
            originalFilename: entry.originalFilename,
          }))}
          preselectedIds={preselectedIds}
        />
      </section>
    </div>
  );
}
