'use client';

import { useState } from 'react';
import { apiRequest } from '@/lib/http/client';
import { Button } from '@/components/ui/button';

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
      }>(`/api/lessons/${lessonId}/revisions/${revision.id}/restore`, {
        method: 'POST',
        body: { version: revision.version },
      });
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
      <Button
        variant="outline"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide history' : 'Revision history'}
      </Button>

      {open ? (
        <div className="border-border bg-background mt-3 rounded-2xl border p-4">
          {revisions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No revisions yet.</p>
          ) : (
            <ul className="space-y-2">
              {revisions.map((revision) => (
                <li key={revision.id} className="flex items-center justify-between gap-3">
                  <span className="text-foreground text-sm">
                    v{revision.version} ·{' '}
                    {revision.authorType === 'system' ? 'Generated' : 'Edited'} ·{' '}
                    {new Date(revision.createdAt).toLocaleString()}
                    {revision.version === currentVersion ? ' (current)' : ''}
                  </span>
                  {revision.version !== currentVersion ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyVersion !== null}
                      onClick={() => void onRestore(revision)}
                    >
                      {busyVersion === revision.version
                        ? 'Restoring…'
                        : `Restore v${revision.version}`}
                    </Button>
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
