import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { RouteProgress } from '@/components/ui/route-progress';

export const metadata: Metadata = {
  title: {
    default: 'Talas',
    template: '%s · Talas',
  },
  description: 'Turn your study material into structured, editable lessons.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <ThemeProvider>
          <RouteProgress />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
