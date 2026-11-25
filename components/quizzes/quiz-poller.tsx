'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';

interface QuizView {
  status: 'queued' | 'processing' | 'ready';
}

const POLL_INTERVAL_MS = 3_000;
/** Ten batches plus queueing — poll for up to twelve minutes client-side. */
const POLL_TIMEOUT_MS = 12 * 60_000;

/**
 * Non-ready quizzes poll themselves and refresh the server-rendered page when
 * the worker settles. Terminal failures delete the quiz (TODO step 15), so a
 * 404 here means the generation failed — surfaced inline, retryable.
 */
export function QuizPoller({ quizId }: { quizId: string }) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const view = await apiRequest<QuizView>(`/api/quizzes/${quizId}`);
        if (cancelled) return;
        if (view.status === 'ready') {
          router.refresh();
          return;
        }
        if (Date.now() - startedAtRef.current > POLL_TIMEOUT_MS) {
          setFailure('The quiz is taking unusually long. Check back on the quizzes page.');
          return;
        }
        timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 404) {
          setFailure('The quiz could not be generated. Try again.');
          router.refresh();
          return;
        }
        timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS * 2);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [quizId, router]);

  const label = failure ? 'Generation failed' : 'Generating your quiz…';

  return (
    <div className="border-border bg-card rounded-2xl border p-8 text-center" data-testid="quiz-progress">
      <p className="text-foreground font-medium">{label}</p>
      <p className="text-muted-foreground mt-1 text-sm">
        {failure
          ? failure
          : 'This page updates automatically — long quizzes can take a few minutes.'}
      </p>
      {failure ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 mx-auto mt-4 max-w-md px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {failure}
        </p>
      ) : null}
    </div>
  );
}
