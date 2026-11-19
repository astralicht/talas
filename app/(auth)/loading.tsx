import { InlineSpinner } from '@/components/ui/spinner';

/** Skeleton for the auth screens while they hydrate and validate state. */
export default function AuthLoading() {
  return (
    <div
      className="border-border bg-card mx-auto w-full max-w-md space-y-4 rounded-2xl border p-8 shadow-sm"
      role="status"
      aria-label="Loading"
    >
      <div className="bg-muted h-6 w-40 animate-pulse rounded" />
      <div className="bg-muted h-4 w-64 animate-pulse rounded" />
      <div className="space-y-3 pt-2">
        <div className="bg-muted h-10 w-full animate-pulse rounded-lg" />
        <div className="bg-muted h-10 w-full animate-pulse rounded-lg" />
        <div className="bg-muted h-10 w-full animate-pulse rounded-lg" />
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <InlineSpinner label="Loading…" />
      </p>
    </div>
  );
}
