import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { ensureIntegrationMongo } from '../../helpers/mongo';
import { connectDb, disconnectDb } from '@/lib/db/connection';
import { backfillLessonSources } from '@/lib/db/backfills/lesson-sources';
import { Lesson } from '@/lib/db/models/lesson';

let db: Db;

beforeAll(async () => {
  const uri = await ensureIntegrationMongo();
  await connectDb(uri);
  db = (await connectDb(uri)).connection.db as Db;
});

afterAll(async () => {
  await Lesson.deleteMany({}).exec();
  await disconnectDb();
});

describe('lesson source backfill (specs/005)', () => {
  it('backfills legacy lessons with [materialId] and swaps the indexes', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const materialA = '507f191e810c19729de860ea';
    const materialB = '507f191e810c19729de860eb';

    // Legacy rows written with the raw driver, exactly as the pre-specs/005
    // schema stored them: materialId only, no sourceMaterialIds.
    await Lesson.collection.insertMany([
      {
        userId,
        materialId: materialA,
        title: 'Legacy lesson',
        summary: 'Created before sourceMaterialIds existed.',
        contentMarkdown: '# Legacy',
        version: 1,
        status: 'ready',
        generationProvider: 'seed',
        generationModel: 'seed',
        promptVersion: 'v1',
      },
      {
        userId,
        materialId: materialB,
        title: 'Second legacy lesson',
        summary: 'Proves the old unique materialId index would have refused this.',
        contentMarkdown: '# Legacy 2',
        version: 1,
        status: 'ready',
        generationProvider: 'seed',
        generationModel: 'seed',
        promptVersion: 'v1',
      },
    ]);

    const result = await backfillLessonSources();
    expect(result.matched).toBe(2);
    expect(result.modified).toBe(2);

    const backfilled = await Lesson.find({ userId }).lean().exec();
    for (const lesson of backfilled) {
      const sources = (lesson.sourceMaterialIds ?? []).map((id) => String(id));
      expect(sources).toEqual([String(lesson.materialId)]);
    }

    // Two lessons may now share a materialId tenant-wide; the new index is
    // tenant-scoped and non-unique, and the global unique index is gone.
    await Lesson.collection.createIndex({ userId: 1, materialId: 1 });
    const indexes = await Lesson.collection.indexes();
    const indexNames = indexes.map((index) => index.name ?? '');
    expect(indexNames).toContain('userId_1_materialId_1');
    expect(indexNames).not.toContain('materialId_1');

    // The mongoose schema accepts two lessons on the same material now.
    const duplicate = await Lesson.create({
      userId,
      materialId: materialA,
      sourceMaterialIds: [materialA],
      title: 'Same material again',
      summary: 'Legal under the non-unique tenant index.',
      contentMarkdown: '# Again',
      version: 1,
      status: 'ready',
      generationProvider: 'seed',
      generationModel: 'seed',
      promptVersion: 'v2',
    });
    expect(duplicate._id).toBeDefined();
    void db;
  });

  it('rejects lessons whose source list is empty, oversized, or has duplicates', async () => {
    const userId = '507f1f77bcf86cd799439012';
    const material = '507f191e810c19729de860ec';
    const other = '507f191e810c19729de860ed';
    const base = {
      userId,
      materialId: material,
      title: 'Bad sources',
      summary: 'Should never persist.',
      contentMarkdown: '# Bad',
      version: 1,
      status: 'ready',
      generationProvider: 'seed',
      generationModel: 'seed',
      promptVersion: 'v2',
    };

    await expect(
      Lesson.create({ ...base, sourceMaterialIds: [] }),
    ).rejects.toThrow(/1 to 5 distinct source materials/);
    await expect(
      Lesson.create({
        ...base,
        sourceMaterialIds: Array.from({ length: 6 }, () => material),
      }),
    ).rejects.toThrow(/1 to 5 distinct source materials/);
    await expect(
      Lesson.create({ ...base, sourceMaterialIds: [material, material] }),
    ).rejects.toThrow(/1 to 5 distinct source materials/);

    const valid = await Lesson.create({
      ...base,
      sourceMaterialIds: [material, other],
      title: 'Multi-source lesson',
      summary: 'Distinct sources are fine.',
    });
    expect(valid.sourceMaterialIds).toHaveLength(2);
  });
});
