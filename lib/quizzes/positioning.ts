import type { GeneratedQuizQuestion } from '@/lib/ai/generate-quiz';

/**
 * Correct-answer position distribution (step 16.2): language models gravitate
 * toward placing the correct option first, so a test-taker can score well by
 * always picking A. Every generated question's options are permuted with a
 * shuffle seeded from the question text, and the answer key is remapped to
 * the option's new position. The seed is deterministic, so the same question
 * always lands the same way (stable across retries and re-renders).
 */
function seededShuffle<T>(items: T[], seedText: string): T[] {
  // Deterministic 32-bit seed from the question text (FNV-1a style mixing).
  let seed = 0x811c9dc5;
  for (const byte of Buffer.from(seedText, 'utf8')) {
    seed = (seed ^ byte) * 0x01000193 >>> 0;
  }
  const next = (): number => {
    // xorshift32: deterministic, well-distributed enough for a shuffle.
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0x100000000;
  };
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    const temp = shuffled[index] as T;
    shuffled[index] = shuffled[swap] as T;
    shuffled[swap] = temp;
  }
  return shuffled;
}

export function distributeCorrectPositions(
  questions: GeneratedQuizQuestion[],
): GeneratedQuizQuestion[] {
  return questions.map((question) => {
    const correctOption = question.options[question.correctIndex] as string;
    const shuffled = seededShuffle(question.options as string[], question.question);
    const correctIndex = shuffled.indexOf(correctOption);
    if (correctIndex === -1) {
      // Defensive: the shuffle must only permute. Return the question as-is.
      return question;
    }
    return { ...question, options: shuffled, correctIndex };
  });
}
