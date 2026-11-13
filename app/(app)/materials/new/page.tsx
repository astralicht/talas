import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { UploadForm } from '@/components/materials/upload-form';

export const metadata: Metadata = { title: 'Upload material' };
export const dynamic = 'force-dynamic';

export default async function NewMaterialPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Upload a study material</h1>
        <p className="text-sm text-muted-foreground">
          Your document is scanned for malware, parsed, and turned into a structured lesson.
        </p>
      </div>

      {!user.emailVerified ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Verify your email before uploading.{' '}
          <Link href="/verify-email" className="font-medium underline">
            Send the link again
          </Link>
          .
        </p>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-6">
        <UploadForm verified={user.emailVerified} />
      </section>
    </div>
  );
}
