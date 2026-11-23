import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, PencilLine, Upload } from 'lucide-react';
import { getSessionUser } from '@/lib/auth/session';
import { buttonVariants } from '@/components/ui/button';
import { Logo, Sparkle } from '@/components/ui/logo';
import { ThemeToggle } from '@/components/auth/theme-toggle';

export const dynamic = 'force-dynamic';

const STEPS = [
  {
    icon: Upload,
    title: 'Upload your material',
    body: 'Drop in a PDF, DOCX, Markdown, or plain-text document — up to 25 MB.',
    card: 'bg-accent-100 dark:bg-accent-200/10',
    iconWrap: 'bg-card',
  },
  {
    icon: FileText,
    title: 'Talas drafts the lesson',
    body: 'Your document becomes a structured Markdown lesson with headings and flow.',
    card: 'bg-brand-100 dark:bg-brand-950/40',
    iconWrap: 'bg-card',
  },
  {
    icon: PencilLine,
    title: 'Shape it and keep it',
    body: 'Edit, regenerate, and refine every revision until it fits how you study.',
    card: 'bg-card border border-border',
    iconWrap: 'bg-brand-500 text-foreground',
  },
];

export default async function HomePage() {
  // A signed-in visitor lands straight in their workspace.
  if (await getSessionUser()) redirect('/dashboard');

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <header className="flex items-center justify-between py-6">
          <Link href="/" aria-label="Talas home">
            <Logo className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link href="/login" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Sign in
            </Link>
          </div>
        </header>

        <section className="relative flex flex-col items-center gap-6 py-16 text-center sm:py-24">
          <Sparkle className="absolute top-6 left-[8%] hidden h-10 w-auto -rotate-12 opacity-90 sm:block" />
          <Sparkle className="absolute top-32 right-[10%] hidden h-6 w-auto rotate-12 opacity-70 sm:block" />
          <div className="space-y-5">
            <h1 className="text-foreground text-4xl font-extrabold tracking-tight sm:text-6xl">
              Turn study material into{' '}
              <span className="relative inline-block">
                <span className="relative z-10">lessons</span>
                <span className="bg-brand-500 absolute inset-x-0 bottom-1 z-0 h-4 rounded-full sm:h-5" />
              </span>{' '}
              you can shape.
            </h1>
            <p className="text-muted-foreground mx-auto max-w-xl text-lg">
              Upload a PDF, DOCX, Markdown, or text document. Talas drafts a structured Markdown
              lesson that you can edit, revise, and keep.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/register" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              Create an account
            </Link>
            <Link href="/login" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              Sign in
            </Link>
          </div>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.title} className={`${step.card} rounded-3xl p-6 text-left`}>
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-full ${step.iconWrap}`}
              >
                <step.icon className="h-5 w-5" />
              </span>
              <h2 className="text-foreground mt-4 text-lg font-bold tracking-tight">
                {step.title}
              </h2>
              <p className="text-muted-foreground mt-1.5 text-sm">{step.body}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
