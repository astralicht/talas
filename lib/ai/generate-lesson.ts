import { generateObject } from 'ai';
import {
  assertWithinDailyBudget,
  BudgetExceededError,
  recordSpend,
} from './budget';
import {
  parseGeneratedLesson,
  type GeneratedLesson,
} from './lesson-schema';
import { lessonToMarkdown } from './markdown';
import {
  buildLessonPrompt,
  buildLessonSystemPrompt,
  buildMultiSourceLessonPrompt,
  LESSON_PROMPT_VERSION,
  MAX_OUTPUT_TOKENS,
  type LessonSourceInput,
} from './prompts';
import { lessonModelCandidates, type LessonModel } from './provider';
import { getEnv } from '@/lib/env';

export type LessonGenerationErrorCode =
  | 'provider_unavailable'
  | 'malformed_model_output'
  | 'budget_exceeded';

export class LessonGenerationError extends Error {
  constructor(
    readonly code: LessonGenerationErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LessonGenerationError';
  }
}

export interface GenerateLessonInput {
  userId: string;
  /** Single-source input (legacy single-material path). */
  filename: string;
  detectedMime: string;
  text: string;
  /** Multi-source input (specs/005); takes precedence over the single fields. */
  sources?: LessonSourceInput[];
  /** User-supplied title; the generated lesson uses exactly this title. */
  title?: string;
}

export interface GenerateLessonOutput {
  lesson: GeneratedLesson;
  markdown: string;
  provider: string;
  model: string;
  promptVersion: string;
}

export interface GenerateObjectUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface GenerateObjectCall {
  (options: {
    model: LessonModel['model'];
    schema: typeof import('./lesson-schema').generatedLessonSchema;
    system: string;
    prompt: string;
    maxOutputTokens: number;
    temperature: number;
  }): Promise<{ object: unknown; usage?: GenerateObjectUsage }>;
}

const defaultGenerateObject: GenerateObjectCall = (options) => {
  if (getEnv().AI_FAKE_LESSON) {
    // Integration stack fake: a deterministic, schema-valid model response.
    return Promise.resolve({
      object: {
        title: 'Generated study lesson',
        summary: 'A structured summary of the uploaded material.',
        sections: [
          {
            heading: 'Overview',
            contentMarkdown: 'Key scientific concepts extracted from the uploaded document.',
            keyPoints: ['Concept one', 'Concept two'],
          },
          {
            heading: 'Deep dive',
            contentMarkdown: 'Additional details reconstructed from the source text.',
          },
        ],
      },
      usage: { inputTokens: 1200, outputTokens: 600 },
    });
  }
  return generateObject({ ...options, schema: options.schema }) as unknown as Promise<{
    object: unknown;
    usage?: GenerateObjectUsage;
  }>;
};

let generateObjectImpl: GenerateObjectCall = defaultGenerateObject;

export function setGenerateObjectForTests(impl: GenerateObjectCall | null): void {
  generateObjectImpl = impl ?? defaultGenerateObject;
}

async function callModel(
  candidate: LessonModel,
  input: GenerateLessonInput,
): Promise<{ object: unknown; usage?: GenerateObjectUsage }> {
  const prompt =
    input.sources && input.sources.length > 0
      ? buildMultiSourceLessonPrompt({ title: input.title, sources: input.sources })
      : buildLessonPrompt(input);
  return generateObjectImpl({
    model: candidate.model,
    schema: (await import('./lesson-schema')).generatedLessonSchema,
    system: buildLessonSystemPrompt(),
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
  });
}

export async function generateLesson(
  input: GenerateLessonInput,
): Promise<GenerateLessonOutput> {
  if (getEnv().AI_FAULT_INJECTION) {
    throw new LessonGenerationError('provider_unavailable', 'Injected AI provider failure');
  }

  try {
    await assertWithinDailyBudget(input.userId);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      throw new LessonGenerationError(
        'budget_exceeded',
        'The daily lesson generation limit has been reached.',
        { cause: error },
      );
    }
    throw error;
  }

  const candidates = lessonModelCandidates();
  const ordered = [candidates.primary, candidates.fallback].filter(
    (candidate): candidate is LessonModel => candidate !== null,
  );

  let lastError: unknown = null;
  for (const candidate of ordered) {
    try {
      const result = await callModel(candidate, input);
      const parsed = parseGeneratedLesson(result.object);
      if (!parsed.ok) {
        throw new LessonGenerationError(
          'malformed_model_output',
          'The model returned an invalid lesson structure.',
        );
      }

      const usage = result.usage ?? {};
      await recordSpend(
        input.userId,
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
      );

      // The user-supplied title (specs/005) wins over the model's suggestion.
      const lesson: GeneratedLesson = input.title
        ? { ...parsed.lesson, title: input.title }
        : parsed.lesson;

      return {
        lesson,
        markdown: lessonToMarkdown(lesson),
        provider: candidate.provider,
        model: candidate.modelId,
        promptVersion: LESSON_PROMPT_VERSION,
      };
    } catch (error) {
      if (error instanceof LessonGenerationError && error.code === 'malformed_model_output') {
        lastError = error;
        continue;
      }
      lastError = error;
    }
  }

  if (lastError instanceof LessonGenerationError) throw lastError;
  throw new LessonGenerationError(
    'provider_unavailable',
    'The AI provider is temporarily unavailable.',
    { cause: lastError },
  );
}
