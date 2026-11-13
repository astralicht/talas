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
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Signed in as {user.email}.</p>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-6">
        <h2 className="text-base font-semibold text-foreground">Export your data</h2>
        <p className="text-sm text-muted-foreground">
          Download a ZIP of your material metadata and Markdown lessons.
        </p>
        <a
          href="/api/account/export"
          className="inline-block rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Download export
        </a>
      </section>

      <section className="space-y-3 rounded-xl border border-red-200 bg-card p-6">
        <h2 className="text-base font-semibold text-red-700">Delete account</h2>
        <DeleteAccountPanel />
      </section>
    </div>
  );
}
