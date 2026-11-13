import Link from 'next/link';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { SignOutButton } from './sign-out-button';
import { ThemeToggle } from './theme-toggle';

export function SessionNav({ user }: { user: AuthenticatedUser }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-base font-semibold text-foreground">
            Talas
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/materials" className="hover:text-foreground">
              Materials
            </Link>
            <Link href="/lessons" className="hover:text-foreground">
              Lessons
            </Link>
            <Link href="/settings" className="hover:text-foreground">
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {!user.emailVerified ? (
            <Link
              href="/verify-email"
              className="rounded-md bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              Verify email
            </Link>
          ) : null}
          <span className="text-sm text-muted-foreground">{user.email}</span>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
