'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/materials', label: 'Materials' },
  { href: '/lessons', label: 'Lessons' },
  { href: '/settings', label: 'Settings' },
];

/**
 * Primary nav links with a current-page highlight. Section matching is
 * prefix-based so detail pages (e.g. /materials/:id) keep their section active.
 */
export function SessionNavLinks() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="text-muted-foreground flex flex-wrap items-center gap-1 text-sm font-medium"
    >
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-full px-2.5 py-1.5 transition-colors sm:px-3 ${
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
