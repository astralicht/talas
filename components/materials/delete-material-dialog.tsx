'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';

export function DeleteMaterialDialog({ materialId }: { materialId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/materials/${materialId}`, { method: 'DELETE' });
      router.push('/materials');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The deletion failed. Try again.');
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:bg-red-950/40 dark:border-red-800 dark:text-red-300"
      >
        Delete material
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-material-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-lg">
            <h2 id="delete-material-title" className="text-base font-semibold text-foreground">
              Delete this material?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The stored file is removed and the material is detached from every lesson that uses it.
              Lessons built only from this material are deleted; lessons built from several materials
              keep their remaining sources. This cannot be undone.
            </p>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-input px-3 py-1.5 text-sm font-medium text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={pending}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {pending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
