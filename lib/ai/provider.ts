import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { getEnv } from '@/lib/env';

export interface LessonModel {
  model: LanguageModel;
  provider: 'openai' | 'google';
  modelId: string;
}

export interface LessonModelCandidates {
  primary: LessonModel;
  fallback: LessonModel | null;
}

export function lessonModelCandidates(): LessonModelCandidates {
  const env = getEnv();
  const provider = env.AI_PROVIDER;

  if (provider === 'google') {
    const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
    return {
      primary: {
        model: google(env.AI_MODEL_GOOGLE),
        provider: 'google',
        modelId: env.AI_MODEL_GOOGLE,
      },
      fallback: env.OPENAI_API_KEY
        ? {
            model: createOpenAI({ apiKey: env.OPENAI_API_KEY })(env.AI_MODEL_OPENAI),
            provider: 'openai',
            modelId: env.AI_MODEL_OPENAI,
          }
        : null,
    };
  }

  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  return {
    primary: {
      model: openai(env.AI_MODEL_OPENAI),
      provider: 'openai',
      modelId: env.AI_MODEL_OPENAI,
    },
    fallback: env.GOOGLE_GENERATIVE_AI_API_KEY
      ? {
          model: createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(
            env.AI_MODEL_GOOGLE,
          ),
          provider: 'google',
          modelId: env.AI_MODEL_GOOGLE,
        }
      : null,
  };
}

export function providerIsConfigured(candidate: LessonModel): boolean {
  return Boolean(candidate.modelId);
}
