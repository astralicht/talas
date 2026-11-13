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
import { sanitizeGeneratedImages } from './images';
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
  /** Stored image URLs the model may reference in its markdown (FR-008). */
  imageCatalog?: string[];
  /** Image-only sources: images the model must see (vision parts). */
  visionImages?: Array<{ dataUrl: string }>;
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
    /** Stored figure URLs offered to the model (FR-008). */
    imageCatalog?: string[];
    /** Vision parts (FR-008): present only for image-only sources. */
    messages?: Array<{
      role: 'user';
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; image: string }
      >;
    }>;
  }): Promise<{ object: unknown; usage?: GenerateObjectUsage }>;
}

const defaultGenerateObject: GenerateObjectCall = (options) => {
  if (getEnv().AI_FAKE_LESSON) {
    // Integration stack fake: a deterministic, schema-valid model response.
    // When a stored image catalog exists, the fake references its first URL so
    // downstream allowlist processing has something legitimate to keep.
    const figure = options.imageCatalog?.[0]
      ? `\n\n![Figure](${options.imageCatalog[0]})`
      : '';
    return Promise.resolve({
      object: {
        title: 'Generated study lesson',
        summary: 'A structured summary of the uploaded material.',
        learningObjectives: ['Understand the key concepts of the material.'],
        sections: [
          {
            heading: 'Overview',
            contentMarkdown: `Key scientific concepts extracted from the uploaded document.${figure}`,
            keyPoints: ['Concept one', 'Concept two'],
            checkUnderstanding: ['What is the main idea of the material?'],
          },
          {
            heading: 'Deep dive',
            contentMarkdown: 'Additional details reconstructed from the source text.',
            misconceptions: ['The source claims everything is equally important.'],
          },
        ],
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
          {
            question: 'How many sections does this lesson cover?',
            options: ['One', 'Two', 'Three', 'None'],
            correctIndex: 1,
            explanation: 'The fake lesson generates exactly two sections.',
          },
        ],
      },
      usage: { inputTokens: 1200, outputTokens: 600 },
    });
  }
  const { messages, ...rest } = options;
  const params = messages
    ? { model: rest.model, schema: rest.schema, system: rest.system, maxOutputTokens: rest.maxOutputTokens, temperature: rest.temperature, messages }
    : { model: rest.model, schema: rest.schema, system: rest.system, maxOutputTokens: rest.maxOutputTokens, temperature: rest.temperature, prompt: rest.prompt };
  return generateObject(params as never) as unknown as Promise<{
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
  const prompt = buildSourcePrompt(input);
  const base = {
    model: candidate.model,
    schema: (await import('./lesson-schema')).generatedLessonSchema,
    system: buildLessonSystemPrompt(),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
  };

  if (input.visionImages && input.visionImages.length > 0) {
    // FR-008: image-only sources travel as vision parts next to the prompt.
    return generateObjectImpl({
      ...base,
      prompt,
      imageCatalog: input.imageCatalog,
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: prompt },
            ...input.visionImages.map((image) => ({
              type: 'image' as const,
              image: image.dataUrl,
            })),
          ],
        },
      ],
    });
  }

  return generateObjectImpl({
    ...base,
    prompt,
    imageCatalog: input.imageCatalog,
  });
}

function buildSourcePrompt(input: GenerateLessonInput): string {
  const prompt =
    input.sources && input.sources.length > 0
      ? buildMultiSourceLessonPrompt({ title: input.title, sources: input.sources })
      : buildLessonPrompt(input);

  if (input.imageCatalog && input.imageCatalog.length > 0) {
    const listing = input.imageCatalog
      .map((url, index) => `- Figure ${index + 1}: ${url}`)
      .join('\n');
    return [
      prompt,
      '',
      'Stored figures you may reference in your markdown (use these exact URLs only):',
      listing,
    ].join('\n');
  }
  return prompt;
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

      // FR-008: only catalog URLs may survive into stored lesson content.
      const markdown = input.imageCatalog
        ? sanitizeGeneratedImages(lessonToMarkdown(lesson), input.imageCatalog)
        : lessonToMarkdown(lesson);

      return {
        lesson,
        markdown,
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
