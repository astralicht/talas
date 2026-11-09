import Link from 'next/link';

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
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="space-y-2">
        <Link href="/" className="text-sm font-semibold tracking-wide text-brand-600 uppercase">
          Talas
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description ? <p className="text-sm text-slate-600">{description}</p> : null}
      </div>
      {children}
      {footer ? <div className="text-sm text-slate-600">{footer}</div> : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      {message}
    </p>
  );
}
