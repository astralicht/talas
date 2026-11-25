'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';
import { Button } from '@/components/ui/button';

export interface NewQuizLesson {
  id: string;
  title: string;
}

interface CreateResponse {
  id: string;
  status: string;
}

interface QuizView {
  id: string;
  status: 'queued' | 'processing' | 'ready';
}

const POLL_INTERVAL_MS = 3_000;
/** Ten batches plus queueing — give long quizzes room before giving up client-side. */
const POLL_TIMEOUT_MS = 12 * 60_000;

/**
 * Explicit quiz creation (TODO step 14): the learner picks 1-N finished
 * lessons (plan-capped), a fixed length, and the request is polled until the
 * worker finishes — then the browser lands on the fresh quiz.
 */
export function NewQuizForm({
  lessons,
  preselectedIds = [],
  itemCounts,
  maxSources,
}: {
  lessons: NewQuizLesson[];
  preselectedIds?: string[];
  itemCounts: number[];
  maxSources: number;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [itemCount, setItemCount] = useState<number>(itemCounts[0] ?? 20);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preselectedIds.filter((id) => lessons.some((lesson) => lesson.id === id))),
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

  function toggle(lessonId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(lessonId)) {
        next.delete(lessonId);
      } else if (next.size < maxSources) {
        next.add(lessonId);
      }
      return next;
    });
  }

  async function pollQuiz(quizId: string): Promise<void> {
    const startedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const view = await apiRequest<QuizView>(`/api/quizzes/${quizId}`);
            if (view.status === 'ready') {
              stopPolling();
              setProgress('Quiz ready — opening it…');
              resolve();
              return;
            }
            if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
              stopPolling();
              reject(
                new Error('The quiz is taking unusually long. Check back on the quizzes page.'),
              );
              return;
            }
            setProgress(
              view.status === 'processing'
                ? `Generating ${itemCount} questions…`
                : 'Queued…',
            );
          } catch (cause) {
            stopPolling();
            // A 404 means the worker removed the quiz at terminal failure
            // (TODO step 15) — surface it as a retryable generation failure.
            reject(
              new Error(
                cause instanceof ApiError && cause.status === 404
                  ? 'The quiz could not be generated. Try again.'
                  : cause instanceof Error
                    ? cause.message
                    : 'Polling failed. Try again.',
              ),
            );
          }
        })();
      }, POLL_INTERVAL_MS);
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (selected.size < 1) {
      setError('Pick at least one finished lesson.');
      return;
    }

    setPending(true);
    setProgress('Queued…');
    try {
      const created = await apiRequest<CreateResponse>('/api/quizzes', {
        method: 'POST',
        body: { title: title.trim(), itemCount, lessonIds: [...selected] },
      });
      await pollQuiz(created.id);
      router.push(`/quizzes/${created.id}`);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'The quiz generation failed. Try again.',
      );
      setProgress(null);
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit} noValidate>
      <div className="space-y-1">
        <label htmlFor="quiz-title" className="text-foreground text-sm font-medium">
          Quiz title
        </label>
        <input
          id="quiz-title"
          name="title"
          type="text"
          required
          minLength={1}
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Dynamics midterm practice"
          className="border-input w-full rounded-lg border px-3 py-2 text-sm"
          disabled={pending}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-foreground text-sm font-medium">Length</legend>
        <div className="flex gap-2">
          {itemCounts.map((count) => (
            <label
              key={count}
              className={`border-input flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm ${
                itemCount === count
                  ? 'bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200 border-transparent'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              <input
                type="radio"
                name="itemCount"
                value={count}
                checked={itemCount === count}
                onChange={() => setItemCount(count)}
                disabled={pending}
                className="sr-only"
              />
              {count} items
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-foreground text-sm font-medium">
          Source lessons (choose 1–{maxSources})
        </legend>
        {lessons.length === 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            No finished lessons yet — a lesson is usable once its status is Ready.
          </p>
        ) : (
          <ul className="divide-border border-border divide-y rounded-lg border">
            {lessons.map((lesson) => (
              <li key={lesson.id} className="flex items-center gap-3 px-3 py-2">
                <input
                  id={`lesson-${lesson.id}`}
                  type="checkbox"
                  checked={selected.has(lesson.id)}
                  onChange={() => toggle(lesson.id)}
                  disabled={pending}
                  className="h-4 w-4"
                />
                <label
                  htmlFor={`lesson-${lesson.id}`}
                  className="text-foreground min-w-0 flex-1 truncate text-sm"
                >
                  {lesson.title}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {progress ? <p className="text-muted-foreground text-sm">{progress}</p> : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={pending || selected.size < 1 || title.trim().length === 0}
        className="w-full"
      >
        {pending ? 'Generating…' : `Generate ${itemCount}-item quiz`}
      </Button>
    </form>
  );
}
