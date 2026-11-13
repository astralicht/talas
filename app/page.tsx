import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // A signed-in visitor lands straight in their workspace.
  if (await getSessionUser()) redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-4">
        <p className="text-brand-600 text-sm font-semibold tracking-wide uppercase">Talas</p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Turn study material into lessons you can shape.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Upload a PDF, DOCX, Markdown, or text document. Talas drafts a structured Markdown lesson
          that you can edit, revise, and keep.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/register"
          className="bg-brand-600 hover:bg-brand-700 rounded-md px-5 py-3 text-sm font-medium text-white"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-input bg-card px-5 py-3 text-sm font-medium text-foreground hover:bg-muted"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
