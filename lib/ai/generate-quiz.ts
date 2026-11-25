import { generateObject } from 'ai';
import { z } from 'zod';
import {
  assertWithinDailyBudget,
  BudgetExceededError,
  recordSpend,
} from './budget';
import { distributeCorrectPositions } from '@/lib/quizzes/positioning';
import { lessonModelCandidates, type LessonModel } from './provider';
import { withProviderRetries } from './provider-retry';
import { getEnv } from '@/lib/env';
import {
  buildQuizBatchPrompt,
  buildQuizSystemPrompt,
  QUESTIONS_PER_BATCH,
  QUIZ_PROMPT_VERSION,
  type QuizSourceLessonInput,
} from './quiz-prompt';
import { MAX_OUTPUT_TOKENS } from './prompts';

export type QuizGenerationErrorCode =
  | 'provider_unavailable'
  | 'malformed_model_output'
  | 'budget_exceeded';

export class QuizGenerationError extends Error {
  constructor(
    readonly code: QuizGenerationErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'QuizGenerationError';
  }
}

export interface QuizSourceLesson {
  lessonId: string;
  title: string;
  contentMarkdown: string;
}

export interface GeneratedQuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  /** Validated against the source lessons; null when the model attributed nothing. */
  sourceLessonTitle: string | null;
}

export interface GenerateQuizInput {
  userId: string;
  /** Exact quiz length: 20, 30, or 50. */
  itemCount: number;
  lessons: QuizSourceLesson[];
}

export interface GenerateQuizOutput {
  questions: GeneratedQuizQuestion[];
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
    schema: typeof quizBatchSchema;
    system: string;
    prompt: string;
    maxOutputTokens: number;
    temperature: number;
  }): Promise<{ object: unknown; usage?: GenerateObjectUsage }>;
}

export const quizBatchSchema = z
  .object({
    questions: z
      .array(
        z.object({
          question: z.string().min(1).max(300),
          options: z.array(z.string().min(1).max(120)).length(4),
          correctIndex: z.number().int().min(0).max(3),
          explanation: z.string().max(300).optional(),
          sourceLessonTitle: z.string().max(200).optional(),
        }),
      )
      .min(1)
      .max(QUESTIONS_PER_BATCH),
  })
  .strict();

const defaultGenerateObject: GenerateObjectCall = (options) => {
  if (getEnv().AI_FAKE_LESSON) {
    // Integration stack fake: a deterministic, schema-valid response with
    // exactly the requested number of distinct questions. Each fake call
    // advances a counter so every batch returns fresh questions — mirroring
    // how a real model never repeats itself verbatim across batches.
    fakeCallCounter += 1;
    const count = Number(options.prompt.match(/exactly (\d+) new/)?.[1] ?? QUESTIONS_PER_BATCH);
    const lessonTitles = [...options.prompt.matchAll(/^Lesson \d+: (.+)$/gm)].map((m) => m[1]);
    const questions = Array.from({ length: count }, (_, index) => ({
      question: `Generated quiz question ${fakeCallCounter * QUESTIONS_PER_BATCH + index + 1}: which statement matches the material?`,
      options: [
        'The correct statement',
        'A plausible but wrong statement',
        'An unrelated statement',
        'The inverse of the correct statement',
      ],
      correctIndex: 0,
      explanation: 'The material supports the correct statement directly.',
      sourceLessonTitle: lessonTitles[index % Math.max(1, lessonTitles.length)],
    }));
    return Promise.resolve({
      object: { questions },
      usage: { inputTokens: 400, outputTokens: 300 },
    });
  }
  const { model, schema, system, prompt, maxOutputTokens, temperature } = options;
  return generateObject({
    model,
    schema,
    system,
    prompt,
    maxOutputTokens,
    temperature,
  }) as unknown as Promise<{ object: unknown; usage?: GenerateObjectUsage }>;
};

let generateObjectImpl: GenerateObjectCall = defaultGenerateObject;

/** Advances per fake call so batched questions never repeat (test fake only). */
let fakeCallCounter = 0;

export function setGenerateObjectForTests(impl: GenerateObjectCall | null): void {
  generateObjectImpl = impl ?? defaultGenerateObject;
}

async function callModel(
  candidate: LessonModel,
  lessons: QuizSourceLessonInput[],
  count: number,
  avoidTopics: string[],
): Promise<{ object: unknown; usage?: GenerateObjectUsage }> {
  return generateObjectImpl({
    model: candidate.model,
    schema: quizBatchSchema,
    system: buildQuizSystemPrompt(),
    prompt: buildQuizBatchPrompt({ lessons, count, avoidTopics }),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.3,
    // OpenCode Go reasoning models: explicit high effort (user setting).
    ...(candidate.provider === 'opengo'
      ? { providerOptions: { 'openai-compatible': { reasoningEffort: 'high' } } }
      : {}),
  });
}

function normalizeQuestion(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Generates exactly `itemCount` distinct multiple-choice questions from 1-7
 * lessons, in batches of five (each call stays inside the 8192-token
 * output cap). Later batches see already-written topics to avoid repetition;
 * the loop allows a couple of extra batches to replace duplicates, and fails
 * when the model cannot produce the requested count. All-or-nothing: any
 * unrecoverable failure throws and the caller refunds the allowance point.
 */
export async function generateQuiz(input: GenerateQuizInput): Promise<GenerateQuizOutput> {
  if (getEnv().AI_FAULT_INJECTION) {
    throw new QuizGenerationError('provider_unavailable', 'Injected AI provider failure');
  }

  try {
    await assertWithinDailyBudget(input.userId);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      throw new QuizGenerationError(
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
  const primary = ordered[0];
  if (!primary) {
    throw new QuizGenerationError('provider_unavailable', 'No AI provider is configured');
  }

  const titleToLesson = new Map(input.lessons.map((lesson) => [lesson.title, lesson]));
  const questions: GeneratedQuizQuestion[] = [];
  const seenQuestions = new Set<string>();
  const providerUsed: { provider: string; model: string } = {
    provider: primary.provider,
    model: primary.modelId,
  };

  const plannedBatches = Math.ceil(input.itemCount / QUESTIONS_PER_BATCH);
  const maxBatches = plannedBatches + 2;

  try {
    for (let batch = 0; batch < maxBatches && questions.length < input.itemCount; batch += 1) {
      const remaining = input.itemCount - questions.length;
      const count = Math.min(QUESTIONS_PER_BATCH, remaining);
      const avoidTopics = questions.slice(-10).map((question) => normalizeQuestion(question.question).slice(0, 80));

      // Bounded retries per candidate absorb the endpoint's intermittent
      // empty completions; budget exhaustion is terminal.
      let batchObject: z.infer<typeof quizBatchSchema> | undefined;
      try {
        const outcome = await withProviderRetries(
          ordered,
          async (candidate) => {
            const result = await callModel(candidate, input.lessons, count, avoidTopics);
            const parsed = quizBatchSchema.safeParse(result.object);
            if (!parsed.success) {
              // A malformed batch is a model-quality transient: retry before
              // falling back to the next provider.
              throw new Error('malformed batch');
            }
            await recordSpend(
              input.userId,
              result.usage?.inputTokens ?? 0,
              result.usage?.outputTokens ?? 0,
            );
            return parsed.data;
          },
          {
            isTerminal: (error) =>
              error instanceof BudgetExceededError ||
              (error instanceof QuizGenerationError && error.code === 'budget_exceeded'),
          },
        );
        batchObject = outcome.result;
        providerUsed.provider = outcome.provider;
        providerUsed.model = outcome.modelId;
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          throw new QuizGenerationError(
            'budget_exceeded',
            'The daily lesson generation limit has been reached.',
            { cause: error },
          );
        }
        throw new QuizGenerationError(
          'provider_unavailable',
          'The AI provider is temporarily unavailable.',
          { cause: error },
        );
      }

      for (const raw of batchObject.questions) {
        const key = normalizeQuestion(raw.question);
        if (seenQuestions.has(key)) continue;
        seenQuestions.add(key);
        // Attribution must name one of the actual source lessons.
        const attributed = raw.sourceLessonTitle
          ? titleToLesson.get(raw.sourceLessonTitle)?.title ?? null
          : null;
        questions.push({
          question: raw.question,
          options: [...raw.options],
          correctIndex: raw.correctIndex,
          explanation: raw.explanation ?? null,
          sourceLessonTitle: attributed,
        });
        if (questions.length >= input.itemCount) break;
      }
    }
  } catch (error) {
    if (error instanceof QuizGenerationError) throw error;
    throw new QuizGenerationError(
      'provider_unavailable',
      'The AI provider is temporarily unavailable.',
      { cause: error },
    );
  }

  if (questions.length < input.itemCount) {
    throw new QuizGenerationError(
      'malformed_model_output',
      'The model produced fewer unique questions than requested. Try again.',
    );
  }

  // Correct-answer position distribution (step 16.2): models gravitate
  // toward putting the correct option first; permute each question's options
  // so the key spreads across A-D regardless of model bias.
  const positioned = distributeCorrectPositions(questions.slice(0, input.itemCount));

  return {
    questions: positioned,
    provider: providerUsed.provider,
    model: providerUsed.model,
    promptVersion: QUIZ_PROMPT_VERSION,
  };
}
