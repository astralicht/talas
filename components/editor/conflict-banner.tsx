'use client';

import { Button } from '@/components/ui/button';

export function ConflictBanner({ onReload }: { onReload: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:bg-amber-950/40"
    >
      <p className="text-sm text-amber-900 dark:text-amber-200">
        This lesson changed while you were editing — your version was not overwritten. Reload to get
        the current version and reapply your edits.
      </p>
      <Button size="sm" className="bg-amber-700 text-white hover:bg-amber-800" onClick={onReload}>
        Reload lesson
      </Button>
    </div>
  );
}
