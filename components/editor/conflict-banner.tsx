'use client';

export function ConflictBanner({ onReload }: { onReload: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 dark:bg-amber-950/40"
    >
      <p className="text-sm text-amber-900">
        This lesson changed while you were editing — your version was not overwritten. Reload to
        get the current version and reapply your edits.
      </p>
      <button
        type="button"
        onClick={onReload}
        className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
      >
        Reload lesson
      </button>
    </div>
  );
}
