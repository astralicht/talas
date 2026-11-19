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
        <h1 className="text-foreground text-3xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Signed in as {user.email}.</p>
      </section>

      <section className="border-border bg-card space-y-3 rounded-2xl border p-6">
        <h2 className="text-base font-bold text-foreground">Export your data</h2>
        <p className="text-muted-foreground text-sm">
          Download a ZIP of your material metadata and Markdown lessons.
        </p>
        <a
          href="/api/account/export"
          className="border-input bg-card hover:bg-muted text-foreground inline-block rounded-full border px-4 py-2 text-sm font-semibold"
        >
          Download export
        </a>
      </section>

      <section className="space-y-3 rounded-2xl border border-red-200 bg-card p-6 dark:border-red-800">
        <h2 className="text-base font-bold text-red-700 dark:text-red-300">Delete account</h2>
        <DeleteAccountPanel />
      </section>
    </div>
  );
}
