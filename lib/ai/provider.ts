import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { randomUUID } from 'node:crypto';
import type { LanguageModel } from 'ai';
import { getEnv } from '@/lib/env';

export interface LessonModel {
  model: LanguageModel;
  provider: 'openai' | 'google' | 'opengo';
  modelId: string;
}

export interface LessonModelCandidates {
  primary: LessonModel;
  fallback: LessonModel | null;
}

/**
 * OpenCode Go inference endpoint (chat-completions compatible; the SDK appends
 * `/chat/completions`). Go-subscription models only — free-tier OpenCode
 * models answer with HTTP 403 to external clients.
 */
const OPENGO_BASE_URL = 'https://opencode.ai/inference/go/openai/v1';

/**
 * Go asks clients to identify themselves with their own user agent and to send
 * a stable session id per conversation (used for routing and prompt caching).
 * One Talas lesson generation is one conversation, so each
 * `lessonModelCandidates()` call mints a fresh session id.
 */
const OPENGO_USER_AGENT = 'talas/0.1.0';

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

  if (provider === 'opengo') {
    const opengo = createOpenAICompatible({
      baseURL: OPENGO_BASE_URL,
      apiKey: env.OPENCODE_API_KEY,
      name: 'opengo',
      headers: {
        'user-agent': OPENGO_USER_AGENT,
        'x-opencode-session': randomUUID(),
      },
    });
    return {
      primary: {
        model: opengo(env.AI_MODEL_OPENGO),
        provider: 'opengo',
        modelId: env.AI_MODEL_OPENGO,
      },
      // The fallback chain is unchanged: OpenAI/Google remain fallbacks when
      // their keys are set, even though the Go subscription is the primary.
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
