'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/http/client';

interface QuizView {
  status: 'queued' | 'processing' | 'ready' | 'failed';
  lastErrorMessage: string | null;
}

const POLL_INTERVAL_MS = 3_000;
/** Ten batches plus queueing — poll for up to twelve minutes client-side. */
const POLL_TIMEOUT_MS = 12 * 60_000;

/**
 * Non-ready quizzes poll themselves and refresh the server-rendered page when
 * the worker settles; a failure renders inline instead of navigating.
 */
export function QuizPoller({
  quizId,
  initialStatus,
}: {
  quizId: string;
  initialStatus: 'queued' | 'processing' | 'ready' | 'failed';
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    if (initialStatus === 'ready' || initialStatus === 'failed') return;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const view = await apiRequest<QuizView>(`/api/quizzes/${quizId}`);
        if (cancelled) return;
        if (view.status !== status) {
          setStatus(view.status);
          if (view.status === 'ready' || view.status === 'failed') {
            if (view.status === 'failed') {
              setError(view.lastErrorMessage ?? 'The quiz generation failed. Try again.');
            }
            router.refresh();
            return;
          }
        }
        if (Date.now() - startedAtRef.current > POLL_TIMEOUT_MS) {
          setError('The quiz is taking unusually long. Check back on the quizzes page.');
          return;
        }
        timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) {
          timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS * 2);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [initialStatus, quizId, router, status]);

  const label =
    status === 'failed'
      ? 'Generation failed'
      : status === 'processing'
        ? 'Generating your quiz…'
        : 'Queued for generation…';

  return (
    <div className="border-border bg-card rounded-2xl border p-8 text-center" data-testid="quiz-progress">
      <p className="text-foreground font-medium">{label}</p>
      <p className="text-muted-foreground mt-1 text-sm">
        {status === 'failed'
          ? error
          : 'This page updates automatically — long quizzes can take a few minutes.'}
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 mx-auto mt-4 max-w-md px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
