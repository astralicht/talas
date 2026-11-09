import { enforceRateLimit, RATE_LIMITS } from './rate-limit';

export const UPLOAD_HOURLY_POINTS = RATE_LIMITS.UPLOAD_HOURLY.points;
export const UPLOAD_MINUTE_POINTS = RATE_LIMITS.UPLOAD_MINUTE.points;

/**
 * Applies the per-user upload limits at presign, confirm, and retry.
 * A single key is used so the minute and hour windows cannot be gamed by
 * switching endpoints.
 */
export async function enforceUploadRateLimit(userId: string): Promise<void> {
  await enforceRateLimit(`upload:user:${userId}`, RATE_LIMITS.UPLOAD);
}
