import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { SessionNav } from '@/components/auth/session-nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-background">
      <SessionNav user={user} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
