import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { registerVerifiedUser } from '../../helpers/client';
import { runPipeline, resetPipelineState, generateLessonForMaterial } from '../../helpers/pipeline';
import { confirmMaterial, uploadToFakeS3 } from '../../helpers/storage-fake';
import { TEXT_MATERIAL_BYTES } from '../../fixtures/materials';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { LessonRevisionRepository } from '@/lib/db/repositories/lesson-revision-repository';
import { Material } from '@/lib/db/models/material';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

async function seedReadyLesson() {
  const user = await registerVerifiedUser(appUrl);
  const upload = await uploadToFakeS3(user.session, user.user.id, 'revisions.md', 'text/markdown', TEXT_MATERIAL_BYTES);
  await confirmMaterial(user.session, upload.materialId);
  await runPipeline();
  // Lesson generation is explicit-only (specs/005).
  await generateLessonForMaterial(upload.materialId, user.user.id);
  const lesson = await new LessonRepository(user.user.id).findByMaterialId(upload.materialId);
  const revisions = new LessonRevisionRepository(user.user.id);
  const history = await revisions.listForLesson(lesson!._id);
  return { user, materialId: upload.materialId, lessonId: lesson!._id.toHexString(), currentVersion: history[0]!.version, history };
}

describe('revision history and deletion cascades', () => {
  it('lists revisions newest-first and restoring appends a new version', async () => {
    const seeded = await seedReadyLesson();
    const { session } = seeded.user;
    const currentVersion = seeded.currentVersion;

    const list = await session.get(`/api/lessons/${seeded.lessonId}/revisions`);
    expect(list.status).toBe(200);
    const data = (list.body as { data: Array<{ id: string; version: number }> }).data;
    expect(data.map((entry) => entry.version)).toEqual([currentVersion]);
    const originalRevisionId = data[0]!.id;

    // Save an edit so there are two versions, then restore the original.
    await session.patch(`/api/lessons/${seeded.lessonId}`, {
      version: currentVersion,
      title: 'Renamed while editing',
      contentMarkdown: 'Completely rewritten content for the restore check.',
    });

    const restore = await session.post(`/api/lessons/${seeded.lessonId}/revisions/${originalRevisionId}/restore`, {
      version: currentVersion,
    });
    expect(restore.status).toBe(200);
    const restored = restore.body as { lesson: { version: number; title: string }; revision: { id: string; version: number; authorType: 'system' | 'user' } };
    expect(restored.lesson.version).toBe(currentVersion + 2); // edit bumped 1, restore bumped 1
    expect(restored.revision.authorType).toBe('user');

    // History is untouched: same revisions still listed, newest first, all distinct.
    const after = await session.get(`/api/lessons/${seeded.lessonId}/revisions`);
    const afterData = (after.body as { data: Array<{ version: number }> }).data;
    expect(afterData.map((entry) => entry.version)).toEqual([3, 2, 1]);

    // Content matches the originally generated markdown, title included.
    const reread = await session.get(`/api/lessons/${seeded.lessonId}`);
    expect((reread.body as { contentMarkdown: string }).contentMarkdown.length).toBeGreaterThan(0);
  });

  it('restoring the current version conflicts honestly', async () => {
    const seeded = await seedReadyLesson();
    const { session } = seeded.user;
    const currentVersion = seeded.currentVersion;
    const revisions = (await session.get(`/api/lessons/${seeded.lessonId}/revisions`)).body as {
      data: Array<{ id: string; version: number }>;
    };
    const currentRevision = revisions.data.find((entry) => entry.version === currentVersion)!;

    const response = await session.post(
      `/api/lessons/${seeded.lessonId}/revisions/${currentRevision.id}/restore`,
      { version: currentVersion },
    );
    expect(response.status).toBe(409);
  });

  it('deleting the material cascades to lesson, revisions, and stored object', async () => {
    const seeded = await seedReadyLesson();
    const { session } = seeded.user;

    const materialBefore = await Material.findById(seeded.materialId).lean<{ storageKey: string }>().exec();
    expect(materialBefore).not.toBeNull();

    const deletion = await session.delete(`/api/materials/${seeded.materialId}`);
    expect(deletion.status).toBe(204);

    // The material row is tombstoned, tenant reads 404, lesson and revisions are gone.
    const materialAfter = await Material.findById(seeded.materialId).lean<{ status: string }>().exec();
    expect(materialAfter?.status).toBe('deleted');

    const materialRead = await session.get(`/api/materials/${seeded.materialId}`);
    expect(materialRead.status).toBe(404);

    expect(await new LessonRepository(seeded.user.user.id).findByMaterialId(seeded.materialId)).toBeNull();
    expect(await new LessonRevisionRepository(seeded.user.user.id).listForLesson(seeded.lessonId)).toHaveLength(0);
    expect((await session.get(`/api/materials/${seeded.materialId}/storage`)).status).toBe(404);
  });
});
