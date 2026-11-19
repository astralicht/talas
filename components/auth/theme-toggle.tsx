'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

/**
 * Sun/Moon theme toggle (specs/005 step 7). Renders a stable placeholder until
 * mounted so the server and client markup agree (hydration-safe).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <span
        aria-hidden="true"
        className="border-input inline-flex h-9 w-9 items-center justify-center rounded-full border"
      />
    );
  }

  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      data-testid="theme-toggle"
      className="border-input text-muted-foreground hover:text-foreground inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
