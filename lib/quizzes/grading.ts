import type { IQuizQuestion } from '@/lib/db/models/quiz';

export interface GradedQuestion {
  /** Option index the user picked (all questions must be answered). */
  yourAnswer: number;
  correctIndex: number;
  correct: boolean;
}

export interface GradedAttempt {
  answers: number[];
  scoreCorrect: number;
  scoreTotal: number;
  questions: GradedQuestion[];
}

/**
 * Grades one attempt server-side (TODO step 16 + 16.1): the answer key never
 * leaves the database before the user commits their picks. Submissions must
 * answer every question — the submit schema rejects skips before grading.
 */
export function gradeAttempt(questions: IQuizQuestion[], answers: number[]): GradedAttempt {
  let scoreCorrect = 0;
  const detail = questions.map((question, index) => {
    const yourAnswer = answers[index] ?? 0;
    const correct = yourAnswer === question.correctIndex;
    if (correct) scoreCorrect += 1;
    return { yourAnswer, correctIndex: question.correctIndex, correct };
  });

  return {
    answers: [...answers],
    scoreCorrect,
    scoreTotal: questions.length,
    questions: detail,
  };
}
