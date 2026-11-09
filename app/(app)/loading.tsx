import { InlineSpinner } from '@/components/ui/spinner';

/** Skeleton shown while workspace segments load their data. */
export default function AppLoading() {
  return (
    <div className="min-h-[60vh] space-y-6" role="status" aria-label="Loading workspace">
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded-md bg-slate-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {['first', 'second'].map((slot) => (
          <div
            key={slot}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="h-5 w-24 animate-pulse rounded bg-slate-200" />
            <div className="mt-4 space-y-3">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-4 w-full animate-pulse rounded bg-slate-100" style={{ opacity: 1 - row * 0.25 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <InlineSpinner label="Loading…" />
      </p>
    </div>
  );
}
