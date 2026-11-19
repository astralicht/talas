'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';
import { Button } from '@/components/ui/button';

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
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Delete material
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-material-title"
          className="bg-foreground/40 fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div className="bg-card w-full max-w-sm rounded-2xl p-6 shadow-lg">
            <h2 id="delete-material-title" className="text-foreground text-base font-bold">
              Delete this material?
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              The stored file is removed and the material is detached from every lesson that uses
              it. Lessons built only from this material are deleted; lessons built from several
              materials keep their remaining sources. This cannot be undone.
            </p>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={onConfirm}
                disabled={pending}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {pending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
