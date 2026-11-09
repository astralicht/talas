import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { SessionNav } from '@/components/auth/session-nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-slate-50">
      <SessionNav user={user} />
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
