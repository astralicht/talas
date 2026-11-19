import Link from 'next/link';
import { Logo } from '@/components/ui/logo';

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="bg-card border-border mx-auto flex w-full max-w-md flex-col gap-6 rounded-2xl border p-8 shadow-sm">
      <div className="space-y-3">
        <Link href="/" aria-label="Talas home" className="inline-flex items-center">
          <Logo className="h-6 w-auto" alt="" />
        </Link>
        <h1 className="text-foreground text-2xl font-extrabold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {children}
      {footer ? <div className="text-muted-foreground text-sm">{footer}</div> : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
    >
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      {message}
    </p>
  );
}
