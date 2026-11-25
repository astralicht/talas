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

  it('scores wrong and skipped picks as zero, normalizing skips to -1', () => {
    const graded = gradeAttempt(questions, [1, null]);
    expect(graded.scoreCorrect).toBe(0);
    expect(graded.questions[0]).toMatchObject({ yourAnswer: 1, correctIndex: 2, correct: false });
    expect(graded.questions[1]).toMatchObject({ yourAnswer: null, correctIndex: 0, correct: false });
    // Stored form: -1 marks the skipped question.
    expect(graded.answers).toEqual([1, -1]);
  });

  it('is safe against out-of-range and missing entries', () => {
    const graded = gradeAttempt(questions, [99]);
    expect(graded.answers).toEqual([-1, -1]);
    expect(graded.scoreCorrect).toBe(0);
    expect(graded.questions[1]?.yourAnswer).toBeNull();
  });
});
