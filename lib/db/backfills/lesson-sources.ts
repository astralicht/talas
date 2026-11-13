import { Lesson } from '@/lib/db/models/lesson';

export interface BackfillSourcesResult {
  /** Documents matching the missing-or-empty filter. */
  matched: number;
  /** Documents that received `sourceMaterialIds = [materialId]`. */
  modified: number;
}

/**
 * One-time backfill for the specs/005 schema change: every lesson that predates
 * `sourceMaterialIds` gets `[materialId]` — the material stays the primary and
 * first source. Indexes on the Lesson collection are synchronized afterwards so
 * the dropped `{ materialId: 1 } unique` index and the new
 * `{ userId: 1, materialId: 1 }` index are applied in the same maintenance run.
 */
export async function backfillLessonSources(): Promise<BackfillSourcesResult> {
  const result = await Lesson.updateMany(
    {
      $or: [
        { sourceMaterialIds: { $exists: false } },
        { sourceMaterialIds: { $size: 0 } },
      ],
    },
    [{ $set: { sourceMaterialIds: ['$materialId'] } }],
  ).exec();

  await Lesson.syncIndexes();

  return {
    matched: result.matchedCount ?? 0,
    modified: result.modifiedCount ?? 0,
  };
}
