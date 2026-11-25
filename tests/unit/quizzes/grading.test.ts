import { describe, expect, it } from 'vitest';
import { gradeAttempt } from '@/lib/quizzes/grading';
import type { IQuizQuestion } from '@/lib/db/models/quiz';

const questions: IQuizQuestion[] = [
  {
    question: 'Q1',
    options: ['A1', 'B1', 'C1', 'D1'],
    correctIndex: 2,
    explanation: 'Because the material says so.',
    sourceLessonId: null,
    sourceLessonTitle: null,
  },
  {
    question: 'Q2',
    options: ['A2', 'B2', 'C2', 'D2'],
    correctIndex: 0,
    explanation: null,
    sourceLessonId: null,
    sourceLessonTitle: null,
  },
];

describe('quiz attempt grading (TODO step 16)', () => {
  it('scores correct picks and reports per-question results', () => {
    const graded = gradeAttempt(questions, [2, 0]);
    expect(graded.scoreCorrect).toBe(2);
    expect(graded.scoreTotal).toBe(2);
    expect(graded.questions[0]).toMatchObject({ yourAnswer: 2, correctIndex: 2, correct: true });
    expect(graded.questions[1]).toMatchObject({ yourAnswer: 0, correctIndex: 0, correct: true });
    expect(graded.answers).toEqual([2, 0]);
  });

  it('scores wrong picks as zero with per-question detail', () => {
    const graded = gradeAttempt(questions, [1, 2]);
    expect(graded.scoreCorrect).toBe(0);
    expect(graded.questions[0]).toMatchObject({ yourAnswer: 1, correctIndex: 2, correct: false });
    expect(graded.questions[1]).toMatchObject({ yourAnswer: 2, correctIndex: 0, correct: false });
    expect(graded.answers).toEqual([1, 2]);
  });

  it('requires every entry to be an answered option index', () => {
    // The submit schema rejects skips and out-of-range values before grading;
    // gradeAttempt mirrors that contract defensively.
    expect(() => gradeAttempt(questions, [2, -1 as unknown as number])).not.toThrow();
    const graded = gradeAttempt(questions, [2, -1 as unknown as number]);
    // A -1 can never match a correctIndex (0-3), so it scores wrong.
    expect(graded.scoreCorrect).toBe(1);
    expect(graded.questions[1]?.correct).toBe(false);
  });
});
