import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { MaterialList } from '@/components/materials/material-list';

export const metadata: Metadata = { title: 'Materials' };
export const dynamic = 'force-dynamic';

export default async function MaterialsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const repository = new MaterialRepository(user.id);
  const { data } = await repository.listPaged({ page: 1, limit: 50 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Materials</h1>
          <p className="text-sm text-slate-600">Documents only you can see.</p>
        </div>
        {user.emailVerified ? (
          <Link
            href="/materials/new"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Upload material
          </Link>
        ) : null}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        {data.length === 0 ? (
          <p className="text-sm text-slate-600">
            No materials yet.{' '}
            {user.emailVerified ? (
              <Link href="/materials/new" className="font-medium text-brand-600 hover:underline">
                Upload your first document.
              </Link>
            ) : (
              'Verify your email to upload materials.'
            )}
          </p>
        ) : (
          <MaterialList materials={data} />
        )}
      </section>
    </div>
  );
}
