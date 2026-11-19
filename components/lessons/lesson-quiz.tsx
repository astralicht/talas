'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export interface LessonQuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * Multiple-choice self-test below a lesson (specs/005 follow-up). Pure client
 * state: answers, scores, and resets are never sent anywhere or recorded.
 */
export function LessonQuiz({ questions }: { questions: LessonQuizQuestion[] }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});

  const answeredCount = Object.keys(answers).length;
  const correctCount = questions.reduce(
    (count, question, index) =>
      answers[index] !== undefined && answers[index] === question.correctIndex ? count + 1 : count,
    0,
  );
  const allAnswered = answeredCount === questions.length;

  function answer(questionIndex: number, optionIndex: number) {
    setAnswers((current) =>
      current[questionIndex] !== undefined ? current : { ...current, [questionIndex]: optionIndex },
    );
  }

  function reset() {
    setAnswers({});
  }

  return (
    <section
      aria-label="Lesson quiz"
      data-testid="lesson-quiz"
      className="border-border bg-card rounded-2xl border p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-foreground text-base font-bold">Test your understanding</h2>
        <span className="text-muted-foreground text-xs">
          {allAnswered
            ? `Score: ${correctCount} of ${questions.length} correct`
            : answeredCount > 0
              ? `${answeredCount} of ${questions.length} answered`
              : 'Nothing is recorded — just for you.'}
        </span>
      </div>

      <ol className="mt-4 space-y-5">
        {questions.map((question, questionIndex) => {
          const chosen = answers[questionIndex];
          const answered = chosen !== undefined;
          const wasCorrect = chosen === question.correctIndex;
          return (
            <li key={question.question} data-testid="quiz-question">
              <p className="text-foreground text-sm font-medium">
                {questionIndex + 1}. {question.question}
              </p>
              <ul className="mt-2 space-y-1.5">
                {question.options.map((option, optionIndex) => {
                  const isCorrect = optionIndex === question.correctIndex;
                  const isChosen = chosen === optionIndex;
                  let optionClasses =
                    'w-full rounded-lg border border-input px-3 py-2 text-left text-sm text-foreground hover:bg-muted';
                  if (answered && isCorrect) {
                    optionClasses =
                      'w-full rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-left text-sm text-accent-600 dark:border-accent-200/30 dark:bg-accent-200/10 dark:text-accent-200';
                  } else if (answered && isChosen) {
                    optionClasses =
                      'w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-left text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300';
                  } else if (answered) {
                    optionClasses =
                      'w-full rounded-lg border border-border px-3 py-2 text-left text-sm text-muted-foreground';
                  }
                  return (
                    <li key={option}>
                      <button
                        type="button"
                        onClick={() => answer(questionIndex, optionIndex)}
                        disabled={answered}
                        aria-pressed={answered && isChosen}
                        data-testid="quiz-option"
                        className={optionClasses}
                      >
                        <span className="font-semibold">{LETTERS[optionIndex]}.</span> {option}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {answered ? (
                <p
                  role="status"
                  data-testid="quiz-result"
                  className={`mt-2 text-sm ${
                    wasCorrect
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-red-700 dark:text-red-300'
                  }`}
                >
                  {wasCorrect
                    ? 'Correct!'
                    : `Not quite — the answer is ${LETTERS[question.correctIndex]}.`}
                  {question.explanation ? ` ${question.explanation}` : ''}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {answeredCount > 0 ? (
        <Button variant="ghost" size="sm" onClick={reset} data-testid="quiz-reset">
          Reset quiz
        </Button>
      ) : null}
    </section>
  );
}
