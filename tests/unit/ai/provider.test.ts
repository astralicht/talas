import { afterEach, describe, expect, it } from 'vitest';
import { lessonModelCandidates } from '@/lib/ai/provider';
import { loadEnv, resetEnvCache } from '@/lib/env';

function withEnv(overrides: Record<string, string>): void {
  for (const [key, value] of Object.entries(overrides)) {
    (process.env as Record<string, string>)[key] = value;
  }
  resetEnvCache();
}

afterEach(() => {
  for (const key of [
    'AI_PROVIDER',
    'OPENAI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'OPENCODE_API_KEY',
    'AI_MODEL_OPENGO',
  ]) {
    delete process.env[key];
  }
  resetEnvCache();
});

describe('lesson model candidates', () => {
  it('uses the OpenCode Go endpoint as primary when AI_PROVIDER is opengo', () => {
    withEnv({ AI_PROVIDER: 'opengo', OPENCODE_API_KEY: 'go-key-test' });
    const candidates = lessonModelCandidates();
    expect(candidates.primary.provider).toBe('opengo');
    expect(candidates.primary.modelId).toBe('glm-5.3');
    expect(candidates.primary.model).toBeTruthy();
    expect(candidates.fallback).toBeNull();
  });

  it('honors AI_MODEL_OPENGO for chat-completions model ids', () => {
    withEnv({ AI_PROVIDER: 'opengo', OPENCODE_API_KEY: 'go-key-test', AI_MODEL_OPENGO: 'kimi-k2' });
    const candidates = lessonModelCandidates();
    expect(candidates.primary.modelId).toBe('kimi-k2');
    expect(candidates.primary.provider).toBe('opengo');
  });

  it('keeps the fallback chain unchanged when an OpenAI key is present', () => {
    withEnv({ AI_PROVIDER: 'opengo', OPENCODE_API_KEY: 'go-key-test', OPENAI_API_KEY: 'oai-key' });
    const candidates = lessonModelCandidates();
    expect(candidates.primary.provider).toBe('opengo');
    expect(candidates.fallback).toMatchObject({ provider: 'openai', modelId: 'gpt-4o' });
  });

  it('requires OPENCODE_API_KEY when AI_PROVIDER is opengo in production', () => {
    const base: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      APP_URL: 'https://talas.example',
      JWT_ACCESS_SECRET: 'prod-access-secret-that-is-long-enough',
      JWT_REFRESH_SECRET: 'prod-refresh-secret-that-is-long-enough',
      CSRF_SECRET: 'prod-csrf-secret-that-is-long-enough',
      S3_ACCESS_KEY_ID: 'prod-s3-key',
      S3_SECRET_ACCESS_KEY: 'prod-s3-secret',
      AI_PROVIDER: 'opengo',
      OPENCODE_API_KEY: '',
    };
    resetEnvCache();
    try {
      expect(() => loadEnv(base)).toThrow(/OPENCODE_API_KEY is required/);
    } finally {
      resetEnvCache();
    }

    resetEnvCache();
    try {
      expect(loadEnv({ ...base, OPENCODE_API_KEY: 'go-key' }).AI_PROVIDER).toBe('opengo');
    } finally {
      resetEnvCache();
    }
  });

  it('leaves the openai and google branches untouched', () => {
    withEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'oai-key', GOOGLE_GENERATIVE_AI_API_KEY: 'goog-key' });
    const openai = lessonModelCandidates();
    expect(openai.primary.provider).toBe('openai');
    expect(openai.fallback).toMatchObject({ provider: 'google' });

    withEnv({ AI_PROVIDER: 'google', OPENAI_API_KEY: 'oai-key', GOOGLE_GENERATIVE_AI_API_KEY: 'goog-key' });
    const google = lessonModelCandidates();
    expect(google.primary.provider).toBe('google');
    expect(google.fallback).toMatchObject({ provider: 'openai' });
  });
});
