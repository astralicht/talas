import Link from 'next/link';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { Logo } from '@/components/ui/logo';
import { SessionNavLinks } from './session-nav-links';
import { SignOutButton } from './sign-out-button';
import { ThemeToggle } from './theme-toggle';

export function SessionNav({ user }: { user: AuthenticatedUser }) {
  return (
    <header className="px-4 pt-4 sm:px-6 sm:pt-6">
      <div className="bg-card border-border mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-3xl border px-4 py-3 shadow-sm sm:rounded-full sm:px-5">
        <div className="flex items-center gap-2 sm:gap-7">
          <Link href="/dashboard" aria-label="Talas home" className="inline-flex items-center">
            <Logo className="h-6 w-auto" alt="" />
          </Link>
          <SessionNavLinks />
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {!user.emailVerified ? (
            <Link
              href="/verify-email"
              className="bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200 inline-flex rounded-full px-3 py-1.5 text-sm font-semibold"
            >
              Verify email
            </Link>
          ) : null}
          <span className="text-muted-foreground hidden text-sm md:inline">{user.email}</span>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
