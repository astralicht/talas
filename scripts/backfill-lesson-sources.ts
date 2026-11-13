import { connectDb, disconnectDb } from '../lib/db/connection';
import { backfillLessonSources } from '../lib/db/backfills/lesson-sources';

/**
 * One-time backfill: existing lessons get `sourceMaterialIds = [materialId]`
 * and the Lesson indexes are synchronized (drops the unique materialId index,
 * creates the non-unique tenant index). Run once after deploying specs/005:
 *
 *   pnpm db:backfill-sources
 */
async function main(): Promise<void> {
  await connectDb();
  const result = await backfillLessonSources();
  console.log(
    `Lesson source backfill complete: matched=${result.matched} modified=${result.modified}; indexes synchronized`,
  );
  await disconnectDb();
}

main().catch(async (error: unknown) => {
  console.error('Lesson source backfill failed', error);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
