'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';

export interface RegenerateMaterial {
  id: string;
  originalFilename: string;
}

interface GenerateResponse {
  requestId: string;
}

interface RequestView {
  requestId: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  lessonId: string | null;
  lastErrorMessage: string | null;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

/**
 * Lesson regeneration (specs/005): optionally re-pick the source materials and
 * regenerate with compare-and-swap on the version the learner sees. Polls the
 * request row, then shows the "Version N generated" banner and refreshes.
 */
export function RegenerateLessonDialog({
  lessonId,
  version,
  currentSourceIds,
  readyMaterials,
}: {
  lessonId: string;
  version: number;
  currentSourceIds: string[];
  readyMaterials: RegenerateMaterial[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(currentSourceIds));

  function toggle(materialId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(materialId)) {
        next.delete(materialId);
      } else {
        next.add(materialId);
      }
      return next;
    });
  }

  async function pollRequest(requestId: string): Promise<RequestView> {
    const startedAt = Date.now();
    for (;;) {
      const view = await apiRequest<RequestView>(`/api/lesson-requests/${requestId}`);
      if (view.status === 'ready') return view;
      if (view.status === 'failed') {
        throw new Error(view.lastErrorMessage ?? 'The regeneration failed. Try again.');
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new Error('The regeneration is taking unusually long. Check back on the lesson later.');
      }
      setProgress(view.status === 'processing' ? 'Regenerating the lesson…' : 'Queued…');
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  async function onRegenerate() {
    setPending(true);
    setProgress('Queued…');
    setError(null);
    try {
      const body: { version: number; materialIds?: string[] } = { version };
      if (selected.size > 0) body.materialIds = [...selected];
      const created = await apiRequest<GenerateResponse>(
        `/api/lessons/${lessonId}/regenerate`,
        { method: 'POST', body },
      );
      const finished = await pollRequest(created.requestId);
      if (finished.lessonId) {
        setBanner('Lesson regenerated — opening the new version…');
        router.refresh();
        // The server component now shows the bumped version banner.
        setTimeout(() => {
          setOpen(false);
          setPending(false);
          setProgress(null);
        }, 800);
      } else {
        setPending(false);
        setProgress(null);
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The regeneration failed. Try again.');
      setPending(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        data-testid="regenerate-lesson"
        className="rounded-md border border-input bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background disabled:opacity-60"
      >
        Regenerate lesson
      </button>

      {banner ? (
        <p
          role="status"
          data-testid="regenerate-banner"
          className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-300 dark:bg-emerald-950/40"
        >
          Version {version + 1} generated.
        </p>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="regenerate-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-lg">
            <h2 id="regenerate-title" className="text-base font-semibold text-foreground">
              Regenerate this lesson?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick the documents it should be built from. The current version is kept in
              history as a revision.
            </p>

            <fieldset className="mt-4 space-y-2">
              <legend className="text-sm font-medium text-foreground">Source materials</legend>
              <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {readyMaterials.map((material) => (
                  <li key={material.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      id={`regen-${material.id}`}
                      type="checkbox"
                      checked={selected.has(material.id)}
                      onChange={() => toggle(material.id)}
                      disabled={pending}
                      className="h-4 w-4"
                    />
                    <label
                      htmlFor={`regen-${material.id}`}
                      className="min-w-0 flex-1 truncate text-sm text-foreground"
                    >
                      {material.originalFilename}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            {progress ? <p className="mt-3 text-sm text-muted-foreground">{progress}</p> : null}
            {error ? (
              <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:text-red-300 dark:bg-red-950/40">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                disabled={pending}
                className="rounded-md border border-input px-3 py-1.5 text-sm font-medium text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onRegenerate}
                disabled={pending || selected.size < 1}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {pending ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
