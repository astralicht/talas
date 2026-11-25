'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/http/client';
import { Button } from '@/components/ui/button';

export interface QuizQuestionView {
  question: string;
  options: string[];
}

export interface QuizAttemptSummary {
  attemptNumber: number;
  scoreCorrect: number;
  scoreTotal: number;
  submittedAt: string;
}

export interface QuizResultQuestion {
  question: string;
  options: string[];
  yourAnswer: number | null;
  correctIndex: number;
  correct: boolean;
  explanation: string | null;
}

export interface QuizAttemptResults {
  attemptNumber: number;
  score: { correct: number; total: number };
  questions: QuizResultQuestion[];
}

type SubmitResponse = QuizAttemptResults;

/**
 * Interactive quiz experience (TODO step 16): answer mode before the first
 * submission, results mode after every submission, unlimited retakes. The
 * answer key only arrives with the submit response — it is graded
 * server-side. An in-progress retake lives in this component's state until
 * submitted (refreshing mid-attempt discards the selections).
 */
export function QuizExperience({
  quizId,
  itemCount,
  questions,
  attempts,
  latestResults,
}: {
  quizId: string;
  itemCount: number;
  questions: QuizQuestionView[];
  attempts: QuizAttemptSummary[];
  latestResults: QuizAttemptResults | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'results' | 'interactive'>(
    latestResults ? 'results' : 'interactive',
  );
  const [selections, setSelections] = useState<Array<number | null>>(() =>
    Array.from({ length: itemCount }, () => null),
  );
  const [results, setResults] = useState<QuizAttemptResults | null>(latestResults);
  const [history, setHistory] = useState<QuizAttemptSummary[]>(attempts);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = useMemo(
    () => selections.filter((selection) => selection !== null).length,
    [selections],
  );

  useEffect(() => {
    // Re-sync when the server re-renders with newer attempts (refresh or
    // navigating back after a submit in another tab).
    if (attempts.length > history.length) setHistory(attempts);
  }, [attempts, history.length]);

  function pick(questionIndex: number, optionIndex: number) {
    setSelections((current) => {
      const next = [...current];
      next[questionIndex] = next[questionIndex] === optionIndex ? null : optionIndex;
      return next;
    });
  }

  async function onSubmit() {
    setError(null);
    setPending(true);
    try {
      const response = await apiRequest<SubmitResponse>(`/api/quizzes/${quizId}/submit`, {
        method: 'POST',
        body: { answers: selections },
      });
      setResults(response);
      setHistory((current) => [
        ...current,
        {
          attemptNumber: response.attemptNumber,
          scoreCorrect: response.score.correct,
          scoreTotal: response.score.total,
          submittedAt: new Date().toISOString(),
        },
      ]);
      setMode('results');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The submission failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  if (mode === 'interactive') {
    const allAnswered = answered === itemCount;
    return (
      <div className="space-y-4">
        {questions.map((question, questionIndex) => (
          <div
            key={questionIndex}
            className="border-border bg-card rounded-2xl border p-5"
            data-testid="quiz-question"
          >
            <p className="text-foreground font-semibold">
              {questionIndex + 1}. {question.question}
            </p>
            <div className="mt-3 space-y-2">
              {question.options.map((option, optionIndex) => {
                const selected = selections[questionIndex] === optionIndex;
                return (
                  <label
                    key={optionIndex}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      selected
                        ? 'border-brand-500 bg-brand-100/60 text-foreground dark:bg-brand-950/30'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`q-${quizId}-${questionIndex}`}
                      checked={selected}
                      onChange={() => pick(questionIndex, optionIndex)}
                      className="mt-0.5 h-4 w-4"
                      aria-label={`Question ${questionIndex + 1} option ${String.fromCharCode(65 + optionIndex)}`}
                    />
                    <span className="text-foreground font-medium">
                      {String.fromCharCode(65 + optionIndex)}.
                    </span>
                    <span className="min-w-0 flex-1">{option}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <div className="border-border bg-card sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-full border px-5 py-3 shadow-sm">
          <span className="text-muted-foreground text-sm" data-testid="quiz-answered-count">
            {allAnswered
              ? `All ${itemCount} answered — ready to submit`
              : `Answered ${answered}/${itemCount} — answer every question to submit`}
          </span>
          <Button
            type="button"
            onClick={() => void onSubmit()}
            disabled={pending || !allAnswered}
            data-testid="quiz-submit"
          >
            {pending ? 'Submitting…' : 'Submit quiz'}
          </Button>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const shown = results ?? latestResults;
  if (!shown) return null;

  const percent = Math.round((shown.score.correct / Math.max(1, shown.score.total)) * 100);

  return (
    <div className="space-y-4" data-testid="quiz-results">
      <div className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5">
        <div>
          <p className="text-foreground text-lg font-extrabold" data-testid="quiz-score">
            {shown.score.correct}/{shown.score.total} · {percent}%
          </p>
          <p className="text-muted-foreground text-sm">
            Attempt #{shown.attemptNumber} of {history.length}
          </p>
        </div>
        {history.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {history.map((entry) => (
              <span
                key={entry.attemptNumber}
                className={`border-border bg-background rounded-full border px-2.5 py-1 text-xs font-medium ${
                  entry.attemptNumber === shown.attemptNumber
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }`}
                title={new Date(entry.submittedAt).toLocaleString()}
              >
                #{entry.attemptNumber}: {entry.scoreCorrect}/{entry.scoreTotal}
              </span>
            ))}
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // A retake starts on a blank answer sheet: clear the previous
            // attempt's selections and any submission error.
            setSelections(Array.from({ length: itemCount }, () => null));
            setError(null);
            setMode('interactive');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          data-testid="quiz-retake"
        >
          Retake quiz
        </Button>
      </div>

      <ol className="space-y-4">
        {shown.questions.map((result, questionIndex) => (
          <li
            key={questionIndex}
            className={`rounded-2xl border p-5 ${
              result.correct
                ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20'
                : 'border-red-300 bg-red-50/60 dark:border-red-800 dark:bg-red-950/20'
            }`}
          >
            <p className="text-foreground font-semibold">
              {questionIndex + 1}. {result.question}
            </p>
            <p className="mt-1 text-xs font-semibold">
              {result.correct ? (
                <span className="text-emerald-700 dark:text-emerald-300">Correct</span>
              ) : (
                <span className="text-red-700 dark:text-red-300">Incorrect</span>
              )}
            </p>
            <ol className="mt-3 space-y-1.5">
              {result.options.map((option, optionIndex) => {
                const isCorrect = optionIndex === result.correctIndex;
                const isYours = optionIndex === result.yourAnswer;
                return (
                  <li
                    key={optionIndex}
                    className={`flex gap-2 rounded-lg px-2 py-1 text-sm ${
                      isCorrect
                        ? 'bg-emerald-100/70 font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : isYours
                          ? 'bg-red-100/70 text-red-900 dark:bg-red-950/40 dark:text-red-200'
                          : 'text-muted-foreground'
                    }`}
                  >
                    <span className="font-medium">{String.fromCharCode(65 + optionIndex)}.</span>
                    <span className="min-w-0 flex-1">
                      {option}
                      {isYours && !isCorrect ? ' (your answer)' : ''}
                      {isCorrect ? ' ✓' : ''}
                    </span>
                  </li>
                );
              })}
            </ol>
            {result.explanation ? (
              <p className="text-muted-foreground mt-3 text-sm">{result.explanation}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
