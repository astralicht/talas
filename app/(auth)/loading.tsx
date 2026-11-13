import { InlineSpinner } from '@/components/ui/spinner';

/** Skeleton for the auth screens while they hydrate and validate state. */
export default function AuthLoading() {
  return (
    <div
      className="mx-auto w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-8 shadow-sm"
      role="status"
      aria-label="Loading"
    >
      <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-64 animate-pulse rounded bg-muted" />
      <div className="space-y-3 pt-2">
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-md bg-slate-200" />
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <InlineSpinner label="Loading…" />
      </p>
    </div>
  );
}
