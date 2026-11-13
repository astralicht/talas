import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { registerVerifiedUser, type RegisteredUser } from '../helpers/client';
import { runPipeline, resetPipelineState, generateLessonForMaterial } from '../helpers/pipeline';
import { confirmMaterial, uploadToFakeS3 } from '../helpers/storage-fake';
import { TEXT_MATERIAL_BYTES } from '../fixtures/materials';

let appUrl: string;
let seeded: { user: RegisteredUser; lessonId: string };

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();

  // One processed lesson backs every contract assertion in this file.
  const user = await registerVerifiedUser(appUrl);
  const upload = await uploadToFakeS3(
    user.session,
    user.user.id,
    'contract-lesson.md',
    'text/markdown',
    TEXT_MATERIAL_BYTES,
  );
  await confirmMaterial(user.session, upload.materialId);
  await runPipeline({ materialId: upload.materialId });
  // Generation is explicit-only (specs/005): request it like the API would.
  await generateLessonForMaterial(upload.materialId, user.user.id);
  const list = await user.session.get('/api/lessons');
  const lessonId = (list.body as { data: Array<{ id: string }> }).data[0]!.id;
  seeded = { user, lessonId };
});

afterAll(async () => {
  await stopTestApp();
});

describe('lessons endpoints contract', () => {
  it('lists lessons in the LessonList shape with summaries only', async () => {
    const response = await seeded.user.session.get('/api/lessons');
    expect(response.status).toBe(200);
    const body = response.body as { data: Array<Record<string, unknown>>; page: number; limit: number; total: number };
    expect(Object.keys(body).sort()).toEqual(['data', 'limit', 'page', 'total']);
    const summary = body.data[0]!;
    expect(Object.keys(summary).sort()).toEqual(['id', 'title', 'updatedAt', 'version']);
  });

  it('returns the full Lesson shape on single read', async () => {
    const single = await seeded.user.session.get(`/api/lessons/${seeded.lessonId}`);
    expect(single.status).toBe(200);
    const body = single.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['contentMarkdown', 'createdAt', 'id', 'materialId', 'summary', 'title', 'updatedAt', 'version'].sort(),
    );
  });

  it('saves with the LessonSaveResponse shape (lesson + revision)', async () => {
    const current = await seeded.user.session.get(`/api/lessons/${seeded.lessonId}`);
    const lesson = current.body as { version: number; title: string; contentMarkdown: string };

    const save = await seeded.user.session.patch(`/api/lessons/${seeded.lessonId}`, {
      version: lesson.version,
      title: lesson.title,
      contentMarkdown: `${lesson.contentMarkdown}\nAppended contract line.`,
    });
    expect(save.status).toBe(200);
    const body = save.body as { lesson: Record<string, unknown>; revision: Record<string, unknown> };
    expect(Object.keys(body).sort()).toEqual(['lesson', 'revision']);
    expect(Object.keys(body.revision).sort()).toEqual(['authorType', 'createdAt', 'id', 'version']);
  });

  it('rejects save schemas strictly', async () => {
    const current = await seeded.user.session.get(`/api/lessons/${seeded.lessonId}`);
    const lesson = current.body as { version: number };
    const injected = await seeded.user.session.patch(`/api/lessons/${seeded.lessonId}`, {
      version: lesson.version,
      title: 'x',
      contentMarkdown: 'stitched content',
      authorType: 'root',
    });
    expect(injected.status).toBe(400);
  });

  it('restores revisions with the same LessonSaveResponse shape', async () => {
    const versions = (await seeded.user.session.get(`/api/lessons/${seeded.lessonId}/revisions`)).body as {
      data: Array<{ id: string; version: number }>;
    };
    expect(versions.data.length).toBeGreaterThan(1);
    // The oldest revision holds the generated content; restoring it appends a new version.
    const target = versions.data.at(-1)!;
    const current = await seeded.user.session.get(`/api/lessons/${seeded.lessonId}`);
    const lesson = current.body as { version: number };

    const restore = await seeded.user.session.post(
      `/api/lessons/${seeded.lessonId}/revisions/${target.id}/restore`,
      { version: target.version },
    );
    expect(restore.status).toBe(200);
    expect(Object.keys(restore.body).sort()).toEqual(['lesson', 'revision']);
    expect((restore.body as { lesson: { version: number } }).lesson.version).toBe(lesson.version + 1);
  });

  it('rejects anonymous reads with the auth envelope', async () => {
    const { TestSession } = await import('../helpers/client');
    const anonymous = new TestSession(appUrl);
    const response = await anonymous.get(`/api/lessons/${seeded.lessonId}`);
    expect(response.status).toBe(401);
  });
});
