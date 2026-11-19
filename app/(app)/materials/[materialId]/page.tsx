import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { MaterialStatusPanels } from '@/components/materials/material-status-panels';
import { DeleteMaterialDialog } from '@/components/materials/delete-material-dialog';
import { buttonVariants } from '@/components/ui/button';
import type { MaterialStatusResponse } from '@/hooks/use-material-status';

export const metadata: Metadata = { title: 'Material' };
export const dynamic = 'force-dynamic';

// Deleted materials 404 above; quarantined files are never served back.
const DOWNLOADABLE_STATUSES: ReadonlySet<string> = new Set([
  'awaiting_upload',
  'uploaded',
  'scanning',
  'queued',
  'processing',
  'ready',
  'failed',
]);

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = await params;
  if (!/^[a-f0-9]{24}$/.test(materialId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect('/login');

  const materials = new MaterialRepository(user.id);
  const lessons = new LessonRepository(user.id);
  const material = await materials.findOwnedById(materialId);
  if (!material || material.status === 'deleted') notFound();
  const lesson = await lessons.findBySourceMaterial(materialId);

  const initial: MaterialStatusResponse = {
    id: material!._id.toHexString(),
    originalFilename: material!.originalFilename,
    detectedMime: material!.detectedMime,
    sizeBytes: material!.sizeBytes,
    status: material!.status,
    scanResult: material!.scanResult,
    pageCount: material!.pageCount,
    failureCode: material!.failureCode,
    failureMessage: material!.failureMessage,
    attempts: 0,
    updatedAt: material!.updatedAt.toISOString(),
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/materials" className="text-sm text-muted-foreground hover:text-foreground">
          ← Materials
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight break-words text-foreground">
            {material!.originalFilename}
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            {DOWNLOADABLE_STATUSES.has(material!.status) ? (
              <a
                href={`/api/materials/${materialId}/download`}
                className="border-input bg-card hover:bg-muted text-foreground rounded-full border px-4 py-2 text-sm font-semibold"
              >
                Download original
              </a>
            ) : null}
            <DeleteMaterialDialog materialId={materialId} />
          </div>
        </div>
      </div>

      {lesson ? (
        <section className="rounded-2xl border border-accent-200 bg-accent-50 p-6 dark:border-accent-200/30 dark:bg-accent-200/10">
          <p className="text-accent-600 dark:text-accent-200 text-sm">
            A lesson built from this material is ready.
          </p>
          <Link
            href={`/lessons/${lesson._id.toHexString()}`}
            className={buttonVariants({ variant: 'primary', size: 'sm' }) + ' mt-3'}
          >
            Open lesson
          </Link>
        </section>
      ) : material!.status === 'ready' ? (
        <section className="border-brand-200 bg-brand-50 dark:border-brand-950 dark:bg-brand-950/30 rounded-2xl border p-6">
          <p className="text-sm text-foreground">
            This document is processed and ready to be used in a lesson.
          </p>
          <Link
            href={`/lessons/new?material=${materialId}`}
            data-testid="use-in-lesson"
            className={buttonVariants({ variant: 'primary', size: 'sm' }) + ' mt-3'}
          >
            Use in lesson
          </Link>
        </section>
      ) : null}

      <section className="border-border bg-card rounded-2xl border p-6">
        <h2 className="mb-4 text-base font-bold text-foreground">Processing</h2>
        <MaterialStatusPanels materialId={materialId} initial={initial} />
      </section>
    </div>
  );
}
