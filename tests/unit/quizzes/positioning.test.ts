import { describe, expect, it } from 'vitest';
import { distributeCorrectPositions } from '@/lib/quizzes/positioning';
import type { GeneratedQuizQuestion } from '@/lib/ai/generate-quiz';

function question(index: number): GeneratedQuizQuestion {
  return {
    question: `Unique question ${index}: which statement matches the material?`,
    options: [
      'The correct statement',
      'A plausible but wrong statement',
      'An unrelated statement',
      'The inverse of the correct statement',
    ],
    correctIndex: 0,
    explanation: 'Grounded in the lesson content.',
    sourceLessonTitle: null,
  };
}

describe('correct-answer position distribution (step 16.2)', () => {
  it('keeps the correct option text and remaps the index', () => {
    const [positioned] = distributeCorrectPositions([question(1)]);
    const correctOption = question(1).options[0];
    expect(positioned?.options).toContain(correctOption);
    expect(positioned?.options).toHaveLength(4);
    expect(positioned?.options[positioned?.correctIndex ?? -1]).toBe(correctOption);
  });

  it('spreads correct answers across all four positions', () => {
    // Twenty distinct questions: the hash-seeded shuffle must not lump the
    // key into one position (the all-A bias this feature exists to fix).
    const positions = new Set(
      distributeCorrectPositions(
        Array.from({ length: 20 }, (_, index) => question(index + 1)),
      ).map((question) => question.correctIndex),
    );
    expect(positions.size).toBe(4);
  });

  it('is deterministic for the same question text', () => {
    const first = distributeCorrectPositions([question(7)]);
    const second = distributeCorrectPositions([question(7)]);
    expect(first[0]?.options).toEqual(second[0]?.options);
    expect(first[0]?.correctIndex).toBe(second[0]?.correctIndex);
  });
});
