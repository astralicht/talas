import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateQuiz,
  setGenerateObjectForTests,
  QuizGenerationError,
} from '@/lib/ai/generate-quiz';
import { resetAiBudgetForTests } from '@/lib/ai/budget';
import { resetEnvCache } from '@/lib/env';

const lessons = [
  {
    lessonId: '507f1f77bcf86cd799439011',
    title: 'Dynamics foundations',
    contentMarkdown: 'Newtonian mechanics relates forces to motion. '.repeat(20),
  },
  {
    lessonId: '507f1f77bcf86cd799439012',
    title: 'Energy and work',
    contentMarkdown: 'Work transfers energy through force over distance. '.repeat(20),
  },
];

beforeEach(() => {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';
  resetEnvCache();
});

afterEach(() => {
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  resetEnvCache();
  resetAiBudgetForTests();
});

describe('quiz generation batching (TODO step 14)', () => {
  it('produces exactly the requested count across batches', async () => {
    let calls = 0;
    setGenerateObjectForTests((options) => {
      calls += 1;
      const count = Number(options.prompt.match(/exactly (\d+) new/)?.[1] ?? 5);
      return Promise.resolve({
        object: {
          questions: Array.from({ length: count }, (_, index) => ({
            question: `Unique question ${calls}-${index}: what does the material state?`,
            options: ['Correct', 'Wrong one', 'Wrong two', 'Wrong three'],
            correctIndex: 0,
            explanation: 'Grounded in the lesson content.',
          })),
        },
        usage: { inputTokens: 100, outputTokens: 80 },
      });
    });
    try {
      const output = await generateQuiz({ userId: '507f1f77bcf86cd799439011', itemCount: 22, lessons });
      // 22 items = five batches of five + two — all distinct, exact count.
      expect(output.questions).toHaveLength(22);
      expect(calls).toBe(5);
      for (const question of output.questions) {
        expect(question.options).toHaveLength(4);
        expect(question.correctIndex).toBeGreaterThanOrEqual(0);
        expect(question.correctIndex).toBeLessThanOrEqual(3);
        expect([lessons[0]?.title, lessons[1]?.title, null]).toContain(question.sourceLessonTitle);
      }
    } finally {
      setGenerateObjectForTests(null);
    }
  });

  it('falls back to the secondary provider when the primary fails a batch', async () => {
    let calls = 0;
    setGenerateObjectForTests((options) => {
      calls += 1;
      // The primary provider fails deterministically (the SDK model's
      // provider reads 'openai.chat'); the fallback succeeds.
      if (String((options.model as { provider?: string }).provider ?? '').startsWith('openai')) {
        throw new Error('primary provider down');
      }
      return Promise.resolve({
        object: {
          questions: [
            {
              question: `Recovered question ${calls}: which option is right?`,
              options: ['A', 'B', 'C', 'D'],
              correctIndex: 1,
            },
          ],
        },
        usage: { inputTokens: 10, outputTokens: 10 },
      });
    });
    try {
      const output = await generateQuiz({ userId: '507f1f77bcf86cd799439011', itemCount: 3, lessons });
      expect(output.questions).toHaveLength(3);
      expect(output.provider).toBe('google');
    } finally {
      setGenerateObjectForTests(null);
    }
  }, 20_000);

  it('fails cleanly when the model cannot produce the requested count', async () => {
    setGenerateObjectForTests(() =>
      Promise.resolve({
        object: {
          questions: [
            {
              question: 'Same question repeated: what is being tested here?',
              options: ['A', 'B', 'C', 'D'],
              correctIndex: 0,
            },
          ],
        },
      }),
    );
    try {
      // Every batch returns the same question; dedupe leaves 1 of 20.
      await expect(
        generateQuiz({ userId: '507f1f77bcf86cd799439011', itemCount: 20, lessons }),
      ).rejects.toMatchObject({ code: 'malformed_model_output' } as Partial<QuizGenerationError>);
    } finally {
      setGenerateObjectForTests(null);
    }
  });
});
