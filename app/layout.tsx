import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { RouteProgress } from '@/components/ui/route-progress';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

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
      <body className={`${inter.variable} min-h-screen font-sans`}>
        <ThemeProvider>
          <RouteProgress />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
