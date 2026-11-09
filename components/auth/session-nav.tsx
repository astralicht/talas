import Link from 'next/link';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { SignOutButton } from './sign-out-button';

export function SessionNav({ user }: { user: AuthenticatedUser }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-base font-semibold text-slate-900">
            Talas
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-4 text-sm text-slate-600">
            <Link href="/dashboard" className="hover:text-slate-900">
              Dashboard
            </Link>
            <Link href="/materials" className="hover:text-slate-900">
              Materials
            </Link>
            <Link href="/lessons" className="hover:text-slate-900">
              Lessons
            </Link>
            <Link href="/settings" className="hover:text-slate-900">
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {!user.emailVerified ? (
            <Link
              href="/verify-email"
              className="rounded-md bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800"
            >
              Verify email
            </Link>
          ) : null}
          <span className="text-sm text-slate-600">{user.email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
