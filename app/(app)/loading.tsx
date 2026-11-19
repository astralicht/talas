import { InlineSpinner } from '@/components/ui/spinner';

/** Skeleton shown while workspace segments load their data. */
export default function AppLoading() {
  return (
    <div className="min-h-[60vh] space-y-6" role="status" aria-label="Loading workspace">
      <div className="space-y-2">
        <div className="bg-muted h-8 w-56 animate-pulse rounded-md" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {['first', 'second'].map((slot) => (
          <div
            key={slot}
            className="border-border bg-card rounded-2xl border p-6 shadow-sm"
          >
            <div className="bg-muted h-5 w-24 animate-pulse rounded" />
            <div className="mt-4 space-y-3">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-4 w-full animate-pulse rounded bg-muted" style={{ opacity: 1 - row * 0.25 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <InlineSpinner label="Loading…" />
      </p>
    </div>
  );
}
