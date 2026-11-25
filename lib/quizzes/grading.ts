import type { IQuizQuestion } from '@/lib/db/models/quiz';

export interface GradedQuestion {
  /** Option index the user picked, or null for a skipped question. */
  yourAnswer: number | null;
  correctIndex: number;
  correct: boolean;
}

export interface GradedAttempt {
  /** Option index per question, -1 normalized for skipped. */
  answers: number[];
  scoreCorrect: number;
  scoreTotal: number;
  questions: GradedQuestion[];
}

/**
 * Grades one attempt server-side (TODO step 16): the answer key never leaves
 * the database before the user commits their picks. Skipped questions score
 * zero and report `yourAnswer: null`.
 */
export function gradeAttempt(
  questions: IQuizQuestion[],
  answers: Array<number | null>,
): GradedAttempt {
  const normalized = questions.map((_, index) => {
    const value = answers[index];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3
      ? value
      : -1;
  });

  let scoreCorrect = 0;
  const detail = questions.map((question, index) => {
    const picked = normalized[index] ?? -1;
    const correct = picked === question.correctIndex;
    if (correct) scoreCorrect += 1;
    return {
      yourAnswer: picked === -1 ? null : picked,
      correctIndex: question.correctIndex,
      correct,
    };
  });

  return {
    answers: normalized,
    scoreCorrect,
    scoreTotal: questions.length,
    questions: detail,
  };
}
