'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';

export interface NewLessonMaterial {
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
 * Explicit lesson creation (specs/005): the learner picks 1-5 processed
 * materials, names the lesson, and the request is polled until the worker
 * finishes — then the browser lands on the fresh lesson.
 */
export function NewLessonForm({
  materials,
  preselectedIds = [],
}: {
  materials: NewLessonMaterial[];
  preselectedIds?: string[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preselectedIds.filter((id) => materials.some((material) => material.id === id))),
  );
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

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

  async function pollRequest(requestId: string): Promise<void> {
    const startedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const view = await apiRequest<RequestView>(`/api/lesson-requests/${requestId}`);
            if (view.status === 'ready') {
              stopPolling();
              setProgress('Lesson ready — opening it…');
              resolve();
              return;
            }
            if (view.status === 'failed') {
              stopPolling();
              reject(new Error(view.lastErrorMessage ?? 'The lesson generation failed. Try again.'));
              return;
            }
            if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
              stopPolling();
              reject(new Error('The lesson is taking unusually long. Check back on the lessons page.'));
              return;
            }
            setProgress(view.status === 'processing' ? 'Generating the lesson…' : 'Queued…');
          } catch (cause) {
            stopPolling();
            reject(cause instanceof Error ? cause : new Error('Polling failed. Try again.'));
          }
        })();
      }, POLL_INTERVAL_MS);
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (selected.size < 1) {
      setError('Pick at least one processed material.');
      return;
    }

    setPending(true);
    setProgress('Queued…');
    try {
      const created = await apiRequest<GenerateResponse>('/api/lessons/generate', {
        method: 'POST',
        body: { title: title.trim(), materialIds: [...selected] },
      });
      await pollRequest(created.requestId);
      // The request view carries the finished lesson id.
      const finished = await apiRequest<RequestView>(`/api/lesson-requests/${created.requestId}`);
      if (finished.lessonId) {
        router.push(`/lessons/${finished.lessonId}`);
        router.refresh();
      } else {
        router.push('/lessons');
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The lesson generation failed. Try again.');
      setProgress(null);
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit} noValidate>
      <div className="space-y-1">
        <label htmlFor="lesson-title" className="text-sm font-medium text-foreground">
          Lesson title
        </label>
        <input
          id="lesson-title"
          name="title"
          type="text"
          required
          minLength={1}
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Photosynthesis foundations"
          className="w-full rounded-md border border-input px-3 py-2 text-sm"
          disabled={pending}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">
          Source materials (choose 1–5)
        </legend>
        {materials.length === 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            No processed materials yet — a material is usable once its status is Ready.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {materials.map((material) => (
              <li key={material.id} className="flex items-center gap-3 px-3 py-2">
                <input
                  id={`material-${material.id}`}
                  type="checkbox"
                  checked={selected.has(material.id)}
                  onChange={() => toggle(material.id)}
                  disabled={pending}
                  className="h-4 w-4"
                />
                <label
                  htmlFor={`material-${material.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-foreground"
                >
                  {material.originalFilename}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {progress ? <p className="text-sm text-muted-foreground">{progress}</p> : null}
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:text-red-300 dark:bg-red-950/40">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || selected.size < 1 || title.trim().length === 0}
        className="w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? 'Generating…' : 'Generate lesson'}
      </button>
    </form>
  );
}
