import { generateObject } from 'ai';
import { z } from 'zod';
import {
  assertWithinDailyBudget,
  BudgetExceededError,
  recordSpend,
} from './budget';
import { parseGeneratedLesson, type GeneratedLesson } from './lesson-schema';
import { lessonToMarkdown } from './markdown';
import {
  buildLessonPrompt,
  buildMultiSourceLessonPrompt,
  MAX_OUTPUT_TOKENS,
  SOURCE_CHAR_CAP,
  type LessonImageInput,
  type LessonSourceInput,
} from './prompts';
import {
  buildOutlineSystemPrompt,
  buildOutlinePrompt,
  buildQuizCallPrompt,
  buildQuizCallSystemPrompt,
  buildSectionPrompt,
  buildSectionSystemPrompt,
  STAGED_LESSON_PROMPT_VERSION,
} from './staged-prompts';
import { sanitizeGeneratedImages } from './images';
import { lessonModelCandidates, type LessonModel } from './provider';
import {
  outlineSchema,
  quizSchema,
  sectionSchema,
  type LessonOutline,
  type LessonQuiz,
  type LessonSectionBody,
} from './lesson-staged-schemas';
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
  /** Stored figure URLs the model may reference in its markdown (FR-008). */
  imageCatalog?: string[];
  /** Stored figures with source context (TODO step 12); the prompt renders
   *  this richer catalog, while `imageCatalog` stays the sanitization
   *  allowlist. When omitted it is derived from `imageCatalog`. */
  images?: LessonImageInput[];
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
    schema: z.ZodType;
    system: string;
    prompt: string;
    maxOutputTokens: number;
    temperature: number;
    /** Provider-specific settings forwarded to the endpoint (e.g. reasoning effort). */
    providerOptions?: Record<string, Record<string, string>>;
    /** Vision parts (FR-008): image-only sources. */
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
  if (getEnv().AI_FAULT_INJECTION) {
    throw new Error('Injected AI provider failure');
  }
  if (getEnv().AI_FAKE_LESSON) {
    // Integration stack fake: deterministic, schema-valid responses for
    // every staged call, keyed off the prompt so each stage gets what it
    // needs (the outline asks for a sections plan, section calls ask for
    // their own body, the quiz call asks for the quiz).
    if (options.schema === outlineSchema || options.prompt.includes('learningObjectives')) {
      const headings = ['Overview', 'Core concepts', 'Deeper patterns', 'Practice'];
      // Assign the first stored figure (listed as "- Figure N (…): URL" in the
      // outline prompt) to the first section so the pipeline exercises the
      // figure-assignment path.
      const assignedFigure = options.prompt.match(/- Figure 1 \([^)]*\): (\S+)/)?.[1];
      return Promise.resolve({
        object: {
          summary: 'A structured summary of the uploaded material.',
          learningObjectives: ['Understand the key concepts of the material.'],
          sections: headings.map((heading, index) => ({
            heading,
            ...(index === 0 && assignedFigure ? { figureUrl: assignedFigure } : {}),
          })),
        },
        usage: { inputTokens: 500, outputTokens: 200 },
      });
    }
    if (options.schema === sectionSchema) {
      const heading = options.prompt.match(/This section's heading: ([^\n]+)/)?.[1] ?? 'Section';
      // Embed the assigned figure when the outline gave this section one.
      const assignedFigure = options.prompt
        .match(/Assigned figure \(embed exactly once if it fits\): (\S+)/)?.[1];
      return Promise.resolve({
        object: {
          contentMarkdown: `Taught section: ${heading}. Key ideas extracted from the source material, explained from first principles with a worked example.${
            assignedFigure ? `\n\n![Figure](${assignedFigure})` : ''
          }`,
          keyPoints: [`Key point for ${heading}`],
          checkUnderstanding: [`Self-check for ${heading}?`],
        },
        usage: { inputTokens: 300, outputTokens: 150 },
      });
    }
    if (options.schema === quizSchema) {
      return Promise.resolve({
        object: {
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
    // Unknown stage: schema-shaped empty object is invalid anyway; let the
    // parse stage reject it.
    return Promise.resolve({ object: {}, usage: { inputTokens: 0, outputTokens: 0 } });
  }
  const { messages, ...rest } = options;
  const params = messages
    ? { model: rest.model, schema: rest.schema, system: rest.system, maxOutputTokens: rest.maxOutputTokens, temperature: rest.temperature, providerOptions: rest.providerOptions, messages }
    : { model: rest.model, schema: rest.schema, system: rest.system, maxOutputTokens: rest.maxOutputTokens, temperature: rest.temperature, providerOptions: rest.providerOptions, prompt: rest.prompt };
  return generateObject(params as never) as unknown as Promise<{
    object: unknown;
    usage?: GenerateObjectUsage;
  }>;
};

let generateObjectImpl: GenerateObjectCall = defaultGenerateObject;

export function setGenerateObjectForTests(impl: GenerateObjectCall | null): void {
  generateObjectImpl = impl ?? defaultGenerateObject;
}

export async function callStage(
  stage: string,
  candidate: LessonModel,
  schema: z.ZodType,
  system: string,
  prompt: string,
): Promise<{ object: unknown; usage?: GenerateObjectUsage }> {
  // OpenCode Go reasoning models: high effort for the content stages
  // (outline, sections), medium for the quiz stage — quiz batches are small,
  // structured tasks that reason cheaply. Native openai/google models don't
  // take this key.
  const reasoningEffort = stage === 'quiz' ? 'medium' : 'high';
  return generateObjectImpl({
    model: candidate.model,
    schema: schema as never,
    system,
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    ...(candidate.provider === 'opengo' && candidate.modelId !== getEnv().AI_MODEL_OPENGO_FALLBACK
      ? { providerOptions: { 'openai-compatible': { reasoningEffort } } }
      : {}),
  }) as unknown as Promise<{ object: unknown; usage?: GenerateObjectUsage }>;
}

function catalogUrls(input: GenerateLessonInput): string[] | undefined {
  if (input.imageCatalog && input.imageCatalog.length > 0) return input.imageCatalog;
  if (input.images && input.images.length > 0) return input.images.map((image) => image.url);
  return undefined;
}

function buildSourcePrompt(input: GenerateLessonInput): string {
  // The richer figure list (with source context) feeds the prompt; the bare
  // URL list stays available as the sanitization allowlist.
  const images =
    input.images ??
    catalogUrls(input)?.map((url) => ({ url, filename: 'stored figure' }));
  const prompt =
    input.sources && input.sources.length > 0
      ? buildMultiSourceLessonPrompt({ title: input.title, sources: input.sources, images })
      : buildLessonPrompt({
          filename: input.filename,
          detectedMime: input.detectedMime,
          text: input.text,
          images,
        });
  return prompt;
}

/**
 * Runs one pipeline stage across the provider chain with bounded retries:
 * three attempts per candidate (linear backoff), first success wins, budget
 * exhaustion is terminal, everything else (empty completions, malformed
 * batches) retries then falls back to the next provider.
 */
async function runStage<T>(
  stage: string,
  ordered: LessonModel[],
  run: (candidate: LessonModel) => Promise<T>,
): Promise<{ result: T; provider: string; modelId: string }> {
  let lastError: unknown = null;
  for (const candidate of ordered) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
        }
        const result = await run(candidate);
        return { result, provider: candidate.provider, modelId: candidate.modelId };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw new LessonGenerationError(
    'provider_unavailable',
    `The AI provider is temporarily unavailable (${stage}).`,
    { cause: lastError },
  );
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
  const ordered = [candidates.primary, candidates.fallback, ...candidates.extraFallbacks].filter(
    (candidate): candidate is LessonModel => candidate !== null,
  );
  const firstCandidate = ordered[0];
  if (!firstCandidate) {
    throw new LessonGenerationError('provider_unavailable', 'No AI provider is configured');
  }

  const usage = { inputTokens: 0, outputTokens: 0 };
  const modelUsed = { provider: firstCandidate.provider, model: firstCandidate.modelId };

  // --- Stage 1: outline (small plan, no content drafting).
  const outlinePrompt = buildOutlinePrompt({
    title: input.title,
    sources: input.sources ?? [
      { filename: input.filename, detectedMime: input.detectedMime, text: input.text },
    ],
    images: input.images ?? catalogUrls(input)?.map((url) => ({ url, filename: 'stored figure' })),
  });
  const sourcePrompt = buildSourcePrompt(input);
  const outlineOutcome = await runStage('outline', ordered, async (candidate) => {
    const result = await callStage(
      'outline',
      candidate,
      outlineSchema,
      buildOutlineSystemPrompt(),
      outlinePrompt,
    );
    const parsed = outlineSchema.safeParse(result.object);
    if (!parsed.success) {
      throw new LessonGenerationError(
        'malformed_model_output',
        'The model returned an invalid lesson outline.',
      );
    }
    usage.inputTokens += result.usage?.inputTokens ?? 0;
    usage.outputTokens += result.usage?.outputTokens ?? 0;
    modelUsed.provider = candidate.provider;
    modelUsed.model = candidate.modelId;
    return parsed.data;
  });
  const outline: LessonOutline = outlineOutcome.result;

  // --- Stage 2: one call per section (tiny task, tiny reasoning).
  const sectionBodies: Array<LessonSectionBody | null> = [];
  const sectionSourceExcerpt = (outline.sections.length > 0 ? sourcePrompt : sourcePrompt).slice(
    0,
    SOURCE_CHAR_CAP,
  );
  for (const section of outline.sections) {
    // Figure allowlist: only URLs from the stored catalog survive; the
    // sanitization pass later strips anything else anyway.
    const figureUrl =
      section.figureUrl && catalogUrls(input)?.includes(section.figureUrl)
        ? section.figureUrl
        : null;
    const outcome = await runStage(`section:${section.heading}`, ordered, async (candidate) => {
      const result = await callStage(
        `section:${section.heading}`,
        candidate,
        sectionSchema,
        buildSectionSystemPrompt(),
        buildSectionPrompt({
          heading: section.heading,
          figureUrl,
          outlineHints: `Lesson summary: ${outline.summary}\nLearning objectives: ${outline.learningObjectives?.join('; ') ?? ''}\nAll sections: ${outline.sections.map((entry) => entry.heading).join(', ')}`,
          sourceText: sectionSourceExcerpt,
        }),
      );
      const parsed = sectionSchema.safeParse(result.object);
      if (!parsed.success) {
        throw new LessonGenerationError(
          'malformed_model_output',
          'The model returned an invalid section body.',
        );
      }
      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;
      modelUsed.provider = candidate.provider;
      modelUsed.model = candidate.modelId;
      return parsed.data;
    });
    sectionBodies.push(outcome.result);
  }

  // --- Stage 3: quiz call (the quiz-batching pattern).
  const lessonTextForQuiz = outline.sections
    .map(
      (section, index) =>
        `## ${section.heading}\n${sectionBodies[index]?.contentMarkdown ?? ''}`,
    )
    .join('\n\n');
  const quizOutcome = await runStage('quiz', ordered, async (candidate) => {
    const result = await callStage(
      'quiz',
      candidate,
      quizSchema,
      buildQuizCallSystemPrompt(),
      buildQuizCallPrompt({ lesson: lessonTextForQuiz }),
    );
    const parsed = quizSchema.safeParse(result.object);
    if (!parsed.success) {
      throw new LessonGenerationError(
        'malformed_model_output',
        'The model returned an invalid quiz.',
      );
    }
    usage.inputTokens += result.usage?.inputTokens ?? 0;
    usage.outputTokens += result.usage?.outputTokens ?? 0;
    modelUsed.provider = candidate.provider;
    modelUsed.model = candidate.modelId;
    return parsed.data;
  });
  const quiz: LessonQuiz = quizOutcome.result;

  await recordSpend(input.userId, usage.inputTokens, usage.outputTokens);

  // Assemble the lesson exactly as the single-call schema expects.
  const sections = outline.sections.map((section, index) => {
    const body = sectionBodies[index] ?? {
      contentMarkdown: `${section.heading} (the model returned no content for this section).`,
    };
    return {
      heading: section.heading,
      contentMarkdown: body.contentMarkdown,
      keyPoints: body.keyPoints,
      misconceptions: body.misconceptions,
      checkUnderstanding: body.checkUnderstanding,
    };
  });

  const rawLesson = {
    title: input.title ?? 'Generated lesson',
    summary: outline.summary,
    learningObjectives: outline.learningObjectives,
    sections,
    quiz: quiz.quiz,
  };
  const parsedLesson = parseGeneratedLesson(rawLesson);
  if (!parsedLesson.ok) {
    // Assembly is deterministic; if the schema still rejects, the stages
    // produced something incompatible. Surface as malformed.
    throw new LessonGenerationError(
      'malformed_model_output',
      `The staged lesson failed final validation: ${parsedLesson.issues[0] ?? 'unknown'}`,
    );
  }

  // The user-supplied title (specs/005) wins over the model's suggestion.
  const lesson: GeneratedLesson = input.title
    ? { ...parsedLesson.lesson, title: input.title }
    : parsedLesson.lesson;

  // FR-008: only catalog URLs may survive into stored lesson content.
  const markdown = catalogUrls(input)
    ? sanitizeGeneratedImages(lessonToMarkdown(lesson), catalogUrls(input)!)
    : lessonToMarkdown(lesson);

  return {
    lesson,
    markdown,
    provider: modelUsed.provider,
    model: modelUsed.model,
    promptVersion: STAGED_LESSON_PROMPT_VERSION,
  };
}

// Legacy exports kept for compatibility with existing tests; the staged
// pipeline replaced the single big call (TODO step 18).
export const PROMPT_VERSION = STAGED_LESSON_PROMPT_VERSION;
