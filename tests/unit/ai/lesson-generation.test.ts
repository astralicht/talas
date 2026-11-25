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

  it('accepts optional pedagogy fields (v2 grounded-but-pedagogical output)', () => {
    const pedagogical = {
      ...validLesson,
      learningObjectives: [
        'Explain how light becomes chemical energy',
        'Describe what the Calvin cycle produces',
      ],
      sections: [
        {
          ...validLesson.sections[0],
          misconceptions: ['Plants eat soil for mass'],
          checkUnderstanding: ['Where in the cell do light reactions occur?'],
        },
        validLesson.sections[1],
      ],
    };
    const result = parseGeneratedLesson(pedagogical);
    expect(result).toMatchObject({ ok: true, lesson: pedagogical });
  });

  it('rejects pedagogy arrays beyond their bounded sizes', () => {
    const tooManyObjectives = {
      ...validLesson,
      learningObjectives: Array.from({ length: 9 }, (_, index) => `Objective ${index + 1}`),
    };
    expect(parseGeneratedLesson(tooManyObjectives).ok).toBe(false);

    const tooManyChecks = {
      ...validLesson,
      sections: [
        {
          ...validLesson.sections[0],
          checkUnderstanding: Array.from({ length: 6 }, (_, index) => `Question ${index + 1}`),
        },
      ],
    };
    expect(parseGeneratedLesson(tooManyChecks).ok).toBe(false);
  });

  it('accepts a well-formed multiple-choice quiz block', () => {
    const quizzed = {
      ...validLesson,
      quiz: [
        {
          question: 'What do light reactions produce?',
          options: ['ATP and NADPH', 'Glucose', 'CO2', 'RuBP'],
          correctIndex: 0,
          explanation: 'Light reactions produce ATP and NADPH for the Calvin cycle.',
        },
      ],
    };
    expect(parseGeneratedLesson(quizzed)).toMatchObject({ ok: true, lesson: quizzed });
  });

  it('rejects quiz questions beyond their bounded shapes', () => {
    const question = {
      question: 'Valid question?',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
    };
    // Six questions exceed the cap of five.
    expect(
      parseGeneratedLesson({ ...validLesson, quiz: Array.from({ length: 6 }, () => question) }).ok,
    ).toBe(false);
    // Three options instead of four.
    expect(
      parseGeneratedLesson({ ...validLesson, quiz: [{ ...question, options: ['A', 'B', 'C'] }] }).ok,
    ).toBe(false);
    // correctIndex outside 0-3.
    expect(
      parseGeneratedLesson({ ...validLesson, quiz: [{ ...question, correctIndex: 4 }] }).ok,
    ).toBe(false);
    // Unknown key smuggled into a question.
    expect(
      parseGeneratedLesson({ ...validLesson, quiz: [{ ...question, answer: 'A' }] }).ok,
    ).toBe(false);
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

  it('renders pedagogy fields deterministically near the top and per section', () => {
    const pedagogical = {
      title: 'Photosynthesis',
      summary: 'How plants convert light into chemical energy.',
      learningObjectives: ['Explain how light becomes chemical energy'],
      sections: [
        {
          heading: 'Light reactions',
          contentMarkdown: 'Light reactions happen in the thylakoids.',
          misconceptions: ['Plants eat soil for mass'],
          checkUnderstanding: ['Where in the cell do light reactions occur?'],
        },
        {
          heading: 'Calvin cycle',
          contentMarkdown: 'The Calvin cycle fixes carbon dioxide.',
          checkUnderstanding: ['What does the Calvin cycle produce?'],
        },
      ],
    };
    const first = lessonToMarkdown(pedagogical);
    const second = lessonToMarkdown({ ...pedagogical });
    expect(first).toBe(second);

    const objectivesIndex = first.indexOf('## Learning objectives');
    const firstSectionIndex = first.indexOf('## Light reactions');
    expect(objectivesIndex).toBeGreaterThan(-1);
    expect(objectivesIndex).toBeLessThan(firstSectionIndex);
    expect(first).toContain('- Explain how light becomes chemical energy');
    expect(first).toContain('### Check your understanding');
    expect(first).toContain('- Where in the cell do light reactions occur?');
    expect(first).toContain('### Common misconceptions');
    expect(first).toContain('- Plants eat soil for mass');
    expect(first.indexOf('### Common misconceptions')).toBeLessThan(
      first.indexOf('### Check your understanding'),
    );
  });
});

describe('lesson generation (staged pipeline, TODO step 18)', () => {
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

  /**
   * A stage-dispatching fake: reads the system prompt to identify which of
   * the three pipeline stages is calling, and answers with a schema-valid
   * payload for that stage.
   */
  function stagedFake(overrides: {
    outline?: () => unknown;
    section?: (heading: string, prompt: string) => unknown;
    quiz?: () => unknown;
  }) {
    return (options: { system: string; prompt: string }): Promise<{ object: unknown }> => {
      if (options.system.includes('plan a lesson')) {
        const assignedFigure = options.prompt
          .match(/- Figure 1 \([^)]*\): (\S+)/)?.[1];
        return Promise.resolve({
          object:
            overrides.outline?.() ?? {
              summary: 'A structured summary of the uploaded material.',
              learningObjectives: ['Understand the key concepts of the material.'],
              sections: [
                { heading: 'Overview', ...(assignedFigure ? { figureUrl: assignedFigure } : {}) },
                { heading: 'Deep dive' },
                { heading: 'Practice' },
              ],
            },
        });
      }
      if (options.system.includes('ONE section')) {
        const heading = options.prompt.match(/This section's heading: ([^\n]+)/)?.[1] ?? 'Section';
        return Promise.resolve({
          object:
            overrides.section?.(heading, options.prompt) ?? {
              contentMarkdown: `Taught section: ${heading}.`,
              keyPoints: [`Key point for ${heading}`],
              checkUnderstanding: [`Self-check for ${heading}?`],
            },
        });
      }
      if (options.system.includes('self-test')) {
        return Promise.resolve({
          object:
            overrides.quiz?.() ?? {
              quiz: [
                {
                  question: 'What is the primary purpose of the material?',
                  options: [
                    'Summarising key concepts for study',
                    'Selling a product',
                    'Entertainment only',
                    'Replacing a textbook',
                  ],
                  correctIndex: 0,
                  explanation: 'The material is study reference content distilled for learners.',
                },
              ],
            },
        });
      }
      return Promise.resolve({ object: { nonsense: true } });
    };
  }

  it('records provider, model, and deterministic markdown on success', async () => {
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-lesson');
    setGenerateObjectForTests(stagedFake({}));
    try {
      const output = await generateLesson(input);
      expect(output.provider).toBe('openai');
      expect(output.markdown).toContain('# Overview');
      expect(output.promptVersion).toBe('v5');
    } finally {
      setGenerateObjectForTests(null);
    }
  }, 20_000);

  it('falls back to the secondary provider when the primary returns garbage at the outline stage', async () => {
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-lesson');
    let outlineCalls = 0;
    setGenerateObjectForTests((options) => {
      // The primary provider fails deterministically at every stage (the SDK
      // model's provider reads 'openai.chat'); the fallback succeeds.
      if (String((options.model as { provider?: string }).provider ?? '').startsWith('openai')) {
        throw new Error('primary provider down');
      }
      if (options.system.includes('plan a lesson')) {
        outlineCalls += 1;
        return Promise.resolve({
          object: {
            summary: 'A structured summary.',
            sections: [{ heading: 'Overview' }, { heading: 'Deep dive' }, { heading: 'Practice' }],
          },
        });
      }
      return Promise.resolve({
        object: options.system.includes('ONE section')
          ? { contentMarkdown: 'Section content.' }
          : { quiz: [{ question: 'Q', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }] },
      });
    });
    try {
      const output = await generateLesson(input);
      expect(outlineCalls).toBe(1);
      expect(output.provider).toBe('google');
    } finally {
      setGenerateObjectForTests(null);
    }
  }, 60_000);

  it('fails safely when the outline schema rejects every provider response', async () => {
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-lesson');
    setGenerateObjectForTests((options) => {
      if (options.system.includes('plan a lesson')) {
        return Promise.resolve({ object: { broken: true } });
      }
      return Promise.resolve({
        object: options.system.includes('ONE section')
          ? { contentMarkdown: 'Content.' }
          : { quiz: [] },
      });
    });
    try {
      // All candidates and attempts fail at the outline stage: the pipeline
      // surfaces provider_unavailable with the malformed cause chained.
      await expect(generateLesson(input)).rejects.toMatchObject({
        code: 'provider_unavailable',
      } as Partial<LessonGenerationError>);
    } finally {
      setGenerateObjectForTests(null);
    }
  }, 20_000);

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
      if (options.system.includes('plan a lesson')) {
        return Promise.resolve({
          object: {
            summary: 'A structured summary.',
            sections: [{ heading: 'Overview' }, { heading: 'Deep dive' }, { heading: 'Practice' }],
          },
        });
      }
      if (options.system.includes('ONE section')) {
        return Promise.resolve({ object: { contentMarkdown: 'Section content.' } });
      }
      return Promise.resolve({
        object: { quiz: [{ question: 'Q', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }] },
      });
    });
    try {
      await generateLesson(input);
      expect(seen.length).toBeGreaterThanOrEqual(1);
      for (const call of seen) {
        expect(call.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
      }
      expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(8192);
    } finally {
      setGenerateObjectForTests(null);
    }
  }, 20_000);
});

describe('stored-figure prompts (TODO step 12, staged)', () => {
  const catalogUrl = '/api/materials/507f1f77bcf86cd799439011/images/507f191e77bcf86cd7994390';
  const images = [
    { url: catalogUrl, filename: 'photosynthesis.pdf', pageNumber: 3, width: 1600, height: 900 },
  ];
  const figureInput = {
    userId: '507f1f77bcf86cd799439011',
    filename: 'photosynthesis.pdf',
    detectedMime: 'application/pdf',
    text: '',
    sources: [
      { filename: 'photosynthesis.pdf', detectedMime: 'application/pdf', text: 'Plants convert light into energy.' },
    ],
    title: 'Figures',
    images,
  };

  beforeEach(() => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';
    resetEnvCache();
  });

  afterEach(() => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    resetEnvCache();
    resetAiBudgetForTests();
  });

  it('renders the figure section with source context into the outline prompt', async () => {
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-lesson');
    const seenPrompts: string[] = [];
    setGenerateObjectForTests((options) => {
      seenPrompts.push(options.prompt);
      if (options.system.includes('plan a lesson')) {
        const assigned = options.prompt
          .match(/- Figure 1 \([^)]*\): (\S+)/)?.[1];
        return Promise.resolve({
          object: {
            summary: 'Summary.',
            sections: [
              { heading: 'Overview', ...(assigned ? { figureUrl: assigned } : {}) },
              { heading: 'Deep dive' },
              { heading: 'Practice' },
            ],
          },
        });
      }
      if (options.system.includes('ONE section')) {
        return Promise.resolve({ object: { contentMarkdown: `See the diagram.\n\n![Diagram](${catalogUrl})` } });
      }
      return Promise.resolve({ object: { quiz: [{ question: 'Q', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }] } });
    });
    try {
      const output = await generateLesson(figureInput);
      // The outline prompt carries the enriched figure catalog.
      const outlinePrompt = seenPrompts.find((p) => p.includes('plan a lesson') || p.includes('Stored figures'));
      expect(outlinePrompt).toContain('Stored figures extracted from the sources');
      expect(outlinePrompt).toContain(`- Figure 1 (from photosynthesis.pdf, page 3, 1600×900): ${catalogUrl}`);
      // The generated markdown keeps the catalog URL (sanitization allowlist).
      expect(output.markdown).toContain(`![Diagram](${catalogUrl})`);
      expect(output.promptVersion).toBe('v5');
    } finally {
      setGenerateObjectForTests(null);
    }
  }, 20_000);

  it('assigns an outline figure to a section and passes the URL into the section call', async () => {
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-lesson');
    const sectionPrompts: string[] = [];
    setGenerateObjectForTests((options) => {
      if (options.system.includes('plan a lesson')) {
        const assigned = options.prompt.match(/- Figure 1 \([^)]*\): (\S+)/)?.[1];
        return Promise.resolve({
          object: {
            summary: 'Summary.',
            sections: [
              { heading: 'Overview', ...(assigned ? { figureUrl: assigned } : {}) },
              { heading: 'Deep dive' },
              { heading: 'Practice' },
            ],
          },
        });
      }
      if (options.system.includes('ONE section')) {
        sectionPrompts.push(options.prompt);
        return Promise.resolve({ object: { contentMarkdown: 'Section body.' } });
      }
      return Promise.resolve({
        object: { quiz: [{ question: 'Q', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }] },
      });
    });
    try {
      await generateLesson(figureInput);
      expect(sectionPrompts.length).toBeGreaterThanOrEqual(1);
      expect(sectionPrompts[0]).toContain(`Assigned figure (embed exactly once if it fits): ${catalogUrl}`);
    } finally {
      setGenerateObjectForTests(null);
    }
  }, 20_000);

  it('strips figure URLs that were never offered', async () => {
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-lesson');
    setGenerateObjectForTests((options) => {
      if (options.system.includes('plan a lesson')) {
        return Promise.resolve({
          object: {
            summary: 'Summary.',
            sections: [{ heading: 'Overview' }, { heading: 'Deep dive' }, { heading: 'Practice' }],
          },
        });
      }
      if (options.system.includes('ONE section')) {
        return Promise.resolve({ object: { contentMarkdown: '![X](/api/materials/other/images/zzz)' } });
      }
      return Promise.resolve({
        object: { quiz: [{ question: 'Q', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }] },
      });
    });
    try {
      const output = await generateLesson(figureInput);
      expect(output.markdown).not.toContain('/api/materials/other/images/zzz');
    } finally {
      setGenerateObjectForTests(null);
    }
  }, 20_000);
});

