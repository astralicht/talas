'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';

export function DeleteLessonDialog({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/lessons/${lessonId}`, { method: 'DELETE' });
      router.push('/lessons');
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
        className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Delete lesson
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-lesson-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
            <h2 id="delete-lesson-title" className="text-base font-semibold text-slate-900">
              Delete this lesson?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              The lesson and its revision history are removed, and the source material with its
              stored file is deleted too. This cannot be undone.
            </p>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
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
