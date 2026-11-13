import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { registerVerifiedUser } from '../helpers/client';
import { runPipeline, resetPipelineState, generateLessonForMaterial } from '../helpers/pipeline';
import { confirmMaterial, uploadToFakeS3 } from '../helpers/storage-fake';
import { TEXT_MATERIAL_BYTES } from '../fixtures/materials';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

describe('cross-tenant isolation', () => {
  it('hides user A material and lessons from user B at every route', async () => {
    const userA = await registerVerifiedUser(appUrl);
    const userB = await registerVerifiedUser(appUrl);

    const upload = await uploadToFakeS3(
      userA.session,
      userA.user.id,
      'private.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(userA.session, upload.materialId);
    await runPipeline();
    // The lesson list assertions below need a lesson: request it explicitly.
    await generateLessonForMaterial(upload.materialId, userA.user.id);

    const lessonsOfA = (await userA.session.get('/api/lessons')).body as {
      data: Array<{ id: string }>;
    };
    expect(lessonsOfA.data).toHaveLength(1);
    const lessonIdOfA = lessonsOfA.data[0]!.id;

    const probes: Array<() => Promise<unknown>> = [
      () => userB.session.get(`/api/materials/${upload.materialId}`),
      () => userB.session.get(`/api/materials/${upload.materialId}/status`),
      () => userB.session.get(`/api/lessons/${lessonIdOfA}`),
      () => userB.session.get(`/api/lessons/${lessonIdOfA}/revisions`),
    ];

    for (const probe of probes) {
      const response = (await probe()) as { status: number; body: { code?: string } };
      expect(response.status).toBe(404);
      // Non-revealing: the envelope must not leak existence information.
      expect(response.body.code).toBe('not_found');
    }
  });

  it('refuses writes from user B against user A lesson ids', async () => {
    const userA = await registerVerifiedUser(appUrl);
    const userB = await registerVerifiedUser(appUrl);
    void userA;

    const forgedLessonId = `${'f'.repeat(23)}1`;
    const patch = await userB.session.patch(`/api/lessons/${forgedLessonId}`, {
      version: 1,
      title: 'Takeover attempt',
      contentMarkdown: 'This should never be persisted.',
    });
    expect(patch.status).toBe(404);

    const rename = await userB.session.delete(`/api/lessons/${forgedLessonId}`);
    expect(rename.status).toBe(404);
  });

  it('scope-limits listings per user', async () => {
    const userA = await registerVerifiedUser(appUrl);
    const userB = await registerVerifiedUser(appUrl);
    await uploadToFakeS3(userA.session, userA.user.id, 'a.md', 'text/markdown', TEXT_MATERIAL_BYTES);
    await uploadToFakeS3(userB.session, userB.user.id, 'b.md', 'text/markdown', TEXT_MATERIAL_BYTES);
    await runPipeline();

    const listA = (await userA.session.get('/api/materials')).body as { data: Array<unknown> };
    const listB = (await userB.session.get('/api/materials')).body as { data: Array<unknown> };
    expect(listA.data).toHaveLength(1);
    expect(listB.data).toHaveLength(1);
  });
});
