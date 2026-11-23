'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { Logo } from '@/components/ui/logo';
import { SessionNavLinks } from './session-nav-links';
import { SignOutButton } from './sign-out-button';
import { ThemeToggle } from './theme-toggle';

/**
 * Session nav (TODO step 10): on desktop (md+) the links sit inline next to
 * the logo and Sign out ends the action row. Below md the links collapse
 * behind a hamburger toggle — the opened menu keeps the orange active-page
 * pill and puts Sign out at its bottom. The theme toggle deliberately stays
 * outside the collapsible section, and the logo keeps its natural size
 * (shrink-0, no wrapping row) so it never squishes on narrow screens.
 */
export function SessionNav({ user }: { user: AuthenticatedUser }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Any navigation collapses the menu again.
  useEffect(() => setOpen(false), [pathname]);

  // Escape closes without navigating.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="px-4 pt-4 sm:px-6 sm:pt-6">
      <div className="bg-card border-border mx-auto max-w-5xl rounded-3xl border px-4 py-3 shadow-sm md:rounded-full md:px-5">
        <div className="flex items-center justify-between gap-x-3">
          <div className="flex items-center gap-2 md:gap-7">
            <Link href="/dashboard" aria-label="Talas home" className="inline-flex shrink-0 items-center">
              <Logo className="h-6 w-auto" alt="" />
            </Link>
            <div className="hidden md:block">
              <SessionNavLinks />
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {!user.emailVerified ? (
              <Link
                href="/verify-email"
                className="bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200 inline-flex shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold"
              >
                Verify email
              </Link>
            ) : null}
            <span className="text-muted-foreground hidden text-sm md:inline">{user.email}</span>
            <ThemeToggle />
            <span className="hidden md:inline-flex">
              <SignOutButton />
            </span>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="session-nav-mobile-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              data-testid="mobile-nav-toggle"
              className="border-input text-muted-foreground hover:text-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors md:hidden"
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {open ? (
          <div id="session-nav-mobile-menu" className="mt-3 border-t border-border pt-2 md:hidden">
            <SessionNavLinks orientation="column" />
            <div className="mt-2 border-t border-border pt-3 [&_a]:w-full [&_button]:w-full">
              <SignOutButton />
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
