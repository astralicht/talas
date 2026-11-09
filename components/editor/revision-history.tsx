'use client';

import { useState } from 'react';
import { apiRequest } from '@/lib/http/client';

export interface RevisionSummary {
  id: string;
  version: number;
  authorType: 'system' | 'user';
  createdAt: string;
}

/**
 * Revision history panel: lists versions newest-first and restores a version as
 * a new revision. Keyboard operable and announced to screen readers.
 */
export function RevisionHistory({
  lessonId,
  currentVersion,
  revisions,
  onRestored,
}: {
  lessonId: string;
  currentVersion: number;
  revisions: RevisionSummary[];
  onRestored: (result: { lesson: { version: number }; revision: { id: string } }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onRestore(revision: RevisionSummary) {
    setBusyVersion(revision.version);
    setError(null);
    try {
      const result = await apiRequest<{
        lesson: { version: number };
        revision: { id: string };
      }>(
        `/api/lessons/${lessonId}/revisions/${revision.id}/restore`,
        { method: 'POST', body: { version: revision.version } },
      );
      onRestored(result);
      setOpen(false);
    } catch {
      setError('The revision could not be restored. Try again.');
    } finally {
      setBusyVersion(null);
    }
  }

  return (
    <section aria-label="Revision history">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {open ? 'Hide history' : 'Revision history'}
      </button>

      {open ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          {revisions.length === 0 ? (
            <p className="text-sm text-slate-600">No revisions yet.</p>
          ) : (
            <ul className="space-y-2">
              {revisions.map((revision) => (
                <li key={revision.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">
                    v{revision.version} · {revision.authorType === 'system' ? 'Generated' : 'Edited'} ·{' '}
                    {new Date(revision.createdAt).toLocaleString()}
                    {revision.version === currentVersion ? ' (current)' : ''}
                  </span>
                  {revision.version !== currentVersion ? (
                    <button
                      type="button"
                      disabled={busyVersion !== null}
                      onClick={() => void onRestore(revision)}
                      className="whitespace-nowrap rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-60"
                    >
                      {busyVersion === revision.version ? 'Restoring…' : `Restore v${revision.version}`}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function fetchRevisions(lessonId: string): Promise<{ data: RevisionSummary[] }> {
  return apiRequest<{ data: RevisionSummary[] }>(`/api/lessons/${lessonId}/revisions`);
}
