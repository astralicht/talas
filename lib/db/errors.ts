export interface MongoLikeError {
  code?: number;
  keyPattern?: Record<string, unknown>;
  keyValue?: Record<string, unknown>;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as MongoLikeError).code === 11000,
  );
}

export function duplicateKeyFields(error: unknown): string[] {
  if (!error || typeof error !== 'object') return [];
  const keyPattern = (error as MongoLikeError).keyPattern;
  if (keyPattern && typeof keyPattern === 'object') return Object.keys(keyPattern);
  return [];
}
