'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/materials', label: 'Materials' },
  { href: '/lessons', label: 'Lessons' },
  { href: '/quizzes', label: 'Quizzes' },
  { href: '/settings', label: 'Settings' },
];

/**
 * Primary nav links with a current-page highlight. Section matching is
 * prefix-based so detail pages (e.g. /materials/:id) keep their section active.
 * `orientation="column"` is the vertical variant used inside the mobile
 * hamburger menu (session-nav.tsx); the orange active pill is identical in
 * both orientations.
 */
export function SessionNavLinks({
  orientation = 'row',
}: {
  orientation?: 'row' | 'column';
} = {}) {
  const pathname = usePathname();
  const vertical = orientation === 'column';
  return (
    <nav
      aria-label="Primary"
      className={`text-muted-foreground flex gap-1 text-sm font-medium ${
        vertical ? 'flex-col items-stretch' : 'flex-wrap items-center'
      }`}
    >
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-full transition-colors ${
              vertical ? 'px-3 py-2 text-left' : 'px-2.5 py-1.5 sm:px-3'
            } ${
              active
                ? 'bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200'
                : 'hover:bg-muted hover:text-foreground'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
