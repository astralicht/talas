import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { registerVerifiedUser, type RegisteredUser } from '../helpers/client';
import { confirmMaterial, uploadToFakeS3 } from '../helpers/storage-fake';
import {
  runGenerationRequest,
  runPipeline,
  resetPipelineState,
} from '../helpers/pipeline';
import { TEXT_MATERIAL_BYTES } from '../fixtures/materials';
import { Lesson } from '@/lib/db/models/lesson';

let appUrl: string;
let seeded: { user: RegisteredUser; materialId: string; requestId: string };

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();

  const user = await registerVerifiedUser(appUrl);
  const upload = await uploadToFakeS3(
    user.session,
    user.user.id,
    'contract-generate.md',
    'text/markdown',
    TEXT_MATERIAL_BYTES,
  );
  await confirmMaterial(user.session, upload.materialId);
  await runPipeline({ materialId: upload.materialId });

  const created = await user.session.post('/api/lessons/generate', {
    title: 'Contract Lesson',
    materialIds: [upload.materialId],
  });
  expect(created.status).toBe(202);
  seeded = {
    user,
    materialId: upload.materialId,
    requestId: (created.body as { requestId: string }).requestId,
  };
});

afterAll(async () => {
  await stopTestApp();
});

describe('lesson-generation request contract', () => {
  it('rejects anonymous requests with the auth envelope', async () => {
    const { TestSession } = await import('../helpers/client');
    const anonymous = new TestSession(appUrl);

    const post = await anonymous.post('/api/lessons/generate', {
      title: 'Anon',
      materialIds: ['507f191e810c19729de860ea'],
    });
    expect(post.status).toBe(401);
    expect(post.body).toMatchObject({ code: expect.any(String), correlationId: expect.any(String) });

    const poll = await anonymous.get(`/api/lesson-requests/${seeded.requestId}`);
    expect(poll.status).toBe(401);
  });

  it('exposes the polling view with the expected shape', async () => {
    const response = await seeded.user.session.get(`/api/lesson-requests/${seeded.requestId}`);
    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'lastErrorCode',
      'lastErrorMessage',
      'lessonId',
      'materialIds',
      'requestId',
      'status',
      'title',
    ]);
    expect(body.status).toBe('queued');
    expect(body.title).toBe('Contract Lesson');
    expect(body.materialIds).toEqual([seeded.materialId]);
    expect(body.lessonId).toBeNull();
  });

  it('drives the request to ready and serves the generated lesson', async () => {
    await runGenerationRequest(seeded.requestId, seeded.user.user.id);

    const poll = await seeded.user.session.get(`/api/lesson-requests/${seeded.requestId}`);
    const view = poll.body as { status: string; lessonId: string | null };
    expect(view.status).toBe('ready');
    expect(view.lessonId).toBeTruthy();

    const lesson = await seeded.user.session.get(`/api/lessons/${view.lessonId}`);
    expect(lesson.status).toBe(200);
    expect((lesson.body as { title: string }).title).toBe('Contract Lesson');
  });

  it('enforces optimistic concurrency on regenerate through the API', async () => {
    const poll = await seeded.user.session.get(`/api/lesson-requests/${seeded.requestId}`);
    const lessonId = (poll.body as { lessonId: string | null }).lessonId as string;

    const lesson = await seeded.user.session.get(`/api/lessons/${lessonId}`);
    const current = lesson.body as { version: number; title: string; contentMarkdown: string };
    expect(current.version).toBe(1);

    // Stale version → 409, non-revealing conflict envelope.
    const stale = await seeded.user.session.post(`/api/lessons/${lessonId}/regenerate`, {
      version: 99,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'conflict', correlationId: expect.any(String) });

    const request = await seeded.user.session.post(`/api/lessons/${lessonId}/regenerate`, {
      version: current.version,
    });
    expect(request.status).toBe(202);
    const view = request.body as { requestId: string };
    await runGenerationRequest(view.requestId, seeded.user.user.id);

    const bumped = await seeded.user.session.get(`/api/lessons/${lessonId}`);
    expect((bumped.body as { version: number }).version).toBe(2);
    const count = await Lesson.countDocuments({ userId: seeded.user.user.id }).exec();
    expect(count).toBe(1);
  });

  it('answers foreign request ids non-revealingly', async () => {
    const other = await registerVerifiedUser(appUrl);
    const response = await other.session.get(`/api/lesson-requests/${seeded.requestId}`);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'not_found' });
  });
});
