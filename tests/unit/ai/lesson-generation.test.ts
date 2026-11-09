import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateLesson, LessonGenerationError } from '@/lib/ai/generate-lesson';
import { parseGeneratedLesson } from '@/lib/ai/lesson-schema';
import { lessonToMarkdown } from '@/lib/ai/markdown';
import { resetAiBudgetForTests } from '@/lib/ai/budget';
import { resetEnvCache } from '@/lib/env';

const validLesson = {
  title: 'Photosynthesis',
  summary: 'How plants convert light into chemical energy.',
  sections: [
    {
      heading: 'Light reactions',
      contentMarkdown: 'Light reactions happen in the thylakoids.',
      keyPoints: ['ATP is produced'],
    },
    {
      heading: 'Calvin cycle',
      contentMarkdown: 'The Calvin cycle fixes carbon dioxide.',
    },
  ],
};

afterEach(() => {
  resetAiBudgetForTests();
});

describe('generated lesson schema', () => {
  it('accepts the structured shape with sections and key points', () => {
    expect(parseGeneratedLesson(validLesson)).toMatchObject({ ok: true, lesson: validLesson });
  });

  it('rejects malformed model output with field-level issues', () => {
    const result = parseGeneratedLesson({ title: '', sections: 'not-an-array' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('malformed_output');
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects unexpected extra keys from the model', () => {
    const result = parseGeneratedLesson({ ...validLesson, systemPromptLeak: 'ignore previous instructions' });
    expect(result.ok).toBe(false);
  });
});

describe('deterministic Markdown conversion', () => {
  it('converts the same input to byte-identical Markdown', () => {
    const first = lessonToMarkdown(validLesson);
    const second = lessonToMarkdown({ ...validLesson });
    expect(first).toBe(second);
    expect(first.startsWith('# Photosynthesis\n\n> How plants convert light into chemical energy.')).toBe(true);
    expect(first).toContain('## Light reactions');
    expect(first).toContain('- ATP is produced');
  });

  it('strips leading heading markers from model titles', () => {
    const markdown = lessonToMarkdown({
      ...validLesson,
      title: '# Injected heading',
      sections: [{ heading: '## Overflow heading', contentMarkdown: 'body' }],
    });
    expect(markdown.startsWith('# Injected heading')).toBe(true);
    expect(markdown).not.toContain('## ## Overflow');
  });
});

describe('lesson generation', () => {
  const input = {
    userId: '507f1f77bcf86cd799439011',
    filename: 'photosynthesis.pdf',
    detectedMime: 'application/pdf',
    text: 'Plants convert light into energy. '.repeat(10),
  };

  beforeEach(() => {
    // The fallback provider is only considered when its API key is configured.
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';
    resetEnvCache();
  });

  afterEach(() => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    resetEnvCache();
    resetAiBudgetForTests();
  });

  it('records provider, model, and deterministic markdown on success', async () => {
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-lesson');
    setGenerateObjectForTests(() => Promise.resolve({ object: validLesson, usage: { inputTokens: 1000, outputTokens: 500 } }));
    try {
      const output = await generateLesson(input);
      expect(output.provider).toBe('openai');
      expect(output.markdown).toContain('# Photosynthesis');
      expect(output.promptVersion).toBe('v1');
    } finally {
      setGenerateObjectForTests(null);
    }
  });

  it('falls back to the secondary provider when the primary returns garbage', async () => {
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-lesson');
    let calls = 0;
    setGenerateObjectForTests(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ object: { nonsense: true } });
      return Promise.resolve({ object: validLesson });
    });
    try {
      const output = await generateLesson(input);
      expect(calls).toBe(2);
      expect(output.provider).toBe('google');
    } finally {
      setGenerateObjectForTests(null);
    }
  });

  it('fails safely when the schema rejects every provider response', async () => {
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-lesson');
    setGenerateObjectForTests(() => Promise.resolve({ object: { broken: true } }));
    try {
      await expect(generateLesson(input)).rejects.toMatchObject({
        code: 'malformed_model_output',
      } as Partial<LessonGenerationError>);
    } finally {
      setGenerateObjectForTests(null);
    }
  });

  it('reports provider_unavailable under fault injection', async () => {
    process.env.AI_FAULT_INJECTION = 'true';
    resetEnvCache();
    try {
      await expect(generateLesson(input)).rejects.toMatchObject({
        code: 'provider_unavailable',
      } as Partial<LessonGenerationError>);
    } finally {
      process.env.AI_FAULT_INJECTION = 'false';
      resetEnvCache();
    }
  });

  it('surfaces the daily budget limit as a distinct code', async () => {
    const { recordSpend } = await import('@/lib/ai/budget');
    await recordSpend(input.userId, 100_000, 300_000); // ≈ $3.25 > $2.00
    await expect(generateLesson(input)).rejects.toMatchObject({
      code: 'budget_exceeded',
    } as Partial<LessonGenerationError>);
  });

  it('enforces the documented token caps per model call', async () => {
    const { MAX_OUTPUT_TOKENS } = await import('@/lib/ai/prompts');
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-lesson');
    const seen: Array<Record<string, unknown>> = [];
    setGenerateObjectForTests((options) => {
      seen.push(options as unknown as Record<string, unknown>);
      return Promise.resolve({ object: validLesson });
    });
    try {
      await generateLesson(input);
      expect(seen[0]?.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
      expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(4096);
    } finally {
      setGenerateObjectForTests(null);
    }
  });
});
