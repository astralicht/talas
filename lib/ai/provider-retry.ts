import type { LessonModel } from './provider';

export interface ProviderRetryOptions {
  /** Attempts per candidate provider before moving to the fallback (default 3). */
  attemptsPerCandidate?: number;
  /** Base backoff between attempts, multiplied by the attempt number (default 2 s). */
  backoffMs?: number;
  /**
   * Terminal errors rethrow immediately instead of retrying — deterministic
   * failures (an exhausted budget) cannot improve across attempts.
   */
  isTerminal?: (error: unknown) => boolean;
}

export interface ProviderOutcome<T> {
  result: T;
  provider: string;
  modelId: string;
}

/**
 * Runs a model call against the configured provider chain with bounded
 * retries: every candidate (primary, then fallback) gets up to
 * `attemptsPerCandidate` attempts with linear backoff. The OpenCode endpoint
 * intermittently returns empty completions for JSON-schema batches, and with
 * no fallback key configured a single unlucky response would otherwise fail
 * the whole generation (seen live on the quiz path, TODO step 15).
 *
 * The first success wins; a terminal error (per `isTerminal`) rethrows
 * immediately; anything else keeps the last error and, when every candidate
 * and attempt is exhausted, throws it for the caller to wrap in its domain
 * error type.
 */
export async function withProviderRetries<T>(
  candidates: LessonModel[],
  run: (candidate: LessonModel) => Promise<T>,
  options: ProviderRetryOptions = {},
): Promise<ProviderOutcome<T>> {
  const attemptsPerCandidate = options.attemptsPerCandidate ?? 3;
  const backoffMs = options.backoffMs ?? 2_000;
  let lastError: unknown = null;

  for (const candidate of candidates) {
    for (let attempt = 0; attempt < attemptsPerCandidate; attempt += 1) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
        }
        const result = await run(candidate);
        return { result, provider: candidate.provider, modelId: candidate.modelId };
      } catch (error) {
        if (options.isTerminal?.(error)) throw error;
        lastError = error;
      }
    }
  }

  throw lastError ?? new Error('No AI provider is configured');
}
