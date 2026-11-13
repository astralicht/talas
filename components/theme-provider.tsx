'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/** Class-based theming (specs/005 step 7); the toggle lives in the session nav. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
