import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { DeleteAccountPanel } from '@/components/settings/delete-account-panel';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-600">Signed in as {user.email}.</p>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">Export your data</h2>
        <p className="text-sm text-slate-600">
          Download a ZIP of your material metadata and Markdown lessons.
        </p>
        <a
          href="/api/account/export"
          className="inline-block rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
        >
          Download export
        </a>
      </section>

      <section className="space-y-3 rounded-xl border border-red-200 bg-white p-6">
        <h2 className="text-base font-semibold text-red-700">Delete account</h2>
        <DeleteAccountPanel />
      </section>
    </div>
  );
}
