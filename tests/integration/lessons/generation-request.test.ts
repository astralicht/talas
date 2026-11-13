import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { registerVerifiedUser, type RegisteredUser } from '../../helpers/client';
import { confirmMaterial, uploadToFakeS3 } from '../../helpers/storage-fake';
import {
  generateLessonForMaterial,
  runGenerationRequest,
  runPipeline,
  resetPipelineState,
} from '../../helpers/pipeline';
import { TEXT_MATERIAL_BYTES } from '../../fixtures/materials';
import { Lesson } from '@/lib/db/models/lesson';
import { LessonRevision } from '@/lib/db/models/lesson-revision';
import { LessonGenerationRequest } from '@/lib/db/models/lesson-generation-request';
import { listMemoryJobsForTests } from '@/lib/jobs/queues';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

/** A fresh user per test keeps the per-user upload and generation limits isolated. */
async function setup(): Promise<RegisteredUser> {
  return registerVerifiedUser(appUrl);
}

async function uploadReadyMaterial(
  user: RegisteredUser,
  filename: string,
): Promise<{ materialId: string }> {
  const upload = await uploadToFakeS3(
    user.session,
    user.user.id,
    filename,
    'text/markdown',
    TEXT_MATERIAL_BYTES,
  );
  await confirmMaterial(user.session, upload.materialId);
  // The automatic pipeline ends at ready (specs/005).
  await runPipeline({ materialId: upload.materialId });
  return { materialId: upload.materialId };
}

describe('explicit lesson-generation requests (specs/005)', () => {
  it('creates a request, generates a multi-source lesson, and exposes progress', async () => {
    const user = await setup();
    const first = await uploadReadyMaterial(user, 'sources-one.md');
    const second = await uploadReadyMaterial(user, 'sources-two.md');

    const response = await user.session.post('/api/lessons/generate', {
      title: 'Forces and Momentum',
      materialIds: [first.materialId, second.materialId],
    });
    expect(response.status).toBe(202);
    const view = response.body as { requestId: string; status: string; title: string; materialIds: string[] };
    expect(view.status).toBe('queued');
    expect(view.title).toBe('Forces and Momentum');
    expect(view.materialIds).toEqual([first.materialId, second.materialId]);

    // Idempotent job id, dedicated queue.
    const queuedJob = listMemoryJobsForTests('lesson-generation').at(-1);
    expect(queuedJob?.id).toBe(`generate_lesson_${view.requestId}`);

    const pollQueued = await user.session.get(`/api/lesson-requests/${view.requestId}`);
    expect(pollQueued.status).toBe(200);
    expect((pollQueued.body as { status: string }).status).toBe('queued');

    await runGenerationRequest(view.requestId, user.user.id);

    const pollReady = await user.session.get(`/api/lesson-requests/${view.requestId}`);
    expect(pollReady.status).toBe(200);
    const ready = pollReady.body as { status: string; lessonId: string | null; lastErrorCode: string | null };
    expect(ready.status).toBe('ready');
    expect(ready.lessonId).toBeTruthy();
    expect(ready.lastErrorCode).toBeNull();

    const lesson = await Lesson.findOne({ userId: user.user.id })
      .lean<{ _id: { toHexString(): string }; title: string; materialId: { toHexString(): string }; sourceMaterialIds: Array<{ toHexString(): string }>; version: number }>()
      .exec();
    expect(lesson?.title).toBe('Forces and Momentum');
    expect(lesson?.materialId.toHexString()).toBe(first.materialId);
    expect(lesson?.sourceMaterialIds.map((id) => id.toHexString())).toEqual([
      first.materialId,
      second.materialId,
    ]);
    expect(lesson?.version).toBe(1);

    const revisions = await LessonRevision.find({ userId: user.user.id }).lean().exec();
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.version).toBe(1);
    expect(revisions[0]?.authorType).toBe('system');
  });

  it('regenerates an existing lesson with CAS on the version', async () => {
    const user = await setup();
    const upload = await uploadReadyMaterial(user, 'regen-source.md');
    await generateLessonForMaterial(upload.materialId, user.user.id);
    const lesson = await Lesson.findOne({ userId: user.user.id })
      .lean<{ _id: { toHexString(): string }; version: number; title: string; contentMarkdown: string }>()
      .exec();
    expect(lesson).toBeTruthy();
    const lessonId = lesson!._id.toHexString();

    // A user save bumps the version, making the previously seen one stale.
    const saved = await user.session.patch(`/api/lessons/${lessonId}`, {
      version: lesson!.version,
      title: lesson!.title,
      contentMarkdown: `${lesson!.contentMarkdown}\nUser edit before regenerating.`,
    });
    expect(saved.status).toBe(200);
    const savedVersion = (saved.body as { lesson: { version: number } }).lesson.version;

    // Stale version: optimistic-concurrency conflict, no request row.
    const stale = await user.session.post(`/api/lessons/${lessonId}/regenerate`, {
      version: lesson!.version,
    });
    expect(stale.status).toBe(409);

    // Same-version CAS passes; the worker appends a new system revision.
    const request = await user.session.post(`/api/lessons/${lessonId}/regenerate`, {
      version: savedVersion,
    });
    expect(request.status).toBe(202);
    const view = request.body as { requestId: string };
    await runGenerationRequest(view.requestId, user.user.id);

    const poll = await user.session.get(`/api/lesson-requests/${view.requestId}`);
    expect((poll.body as { status: string; lessonId: string | null }).status).toBe('ready');
    expect((poll.body as { lessonId: string | null }).lessonId).toBe(lessonId);

    const regenerated = await Lesson.findById(lessonId).lean<{ version: number; sourceMaterialIds: unknown[] }>().exec();
    expect(regenerated?.version).toBe(savedVersion + 1);
    expect(regenerated?.sourceMaterialIds).toHaveLength(1);

    const revisions = await LessonRevision.find({ lessonId }).lean<{ version: number; authorType: string }[]>().exec();
    expect(revisions.map((revision) => revision.version).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    // The user edit (v2) keeps its authorship; the regeneration appends a system revision.
    const byVersion = new Map(revisions.map((revision) => [revision.version, revision.authorType]));
    expect(byVersion.get(1)).toBe('system');
    expect(byVersion.get(2)).toBe('user');
    expect(byVersion.get(3)).toBe('system');
  });

  it('answers non-revealing 404s for foreign and not-ready materials', async () => {
    const user = await setup();
    const other = await setup();
    const foreignUpload = await uploadToFakeS3(
      other.session,
      other.user.id,
      'theirs.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(other.session, foreignUpload.materialId);
    await runPipeline({ materialId: foreignUpload.materialId });

    const foreign = await user.session.post('/api/lessons/generate', {
      title: 'Foreign attempt',
      materialIds: [foreignUpload.materialId],
    });
    expect(foreign.status).toBe(404);
    expect((foreign.body as { code: string }).code).toBe('not_found');

    // A material that exists but never finished the pipeline is equally 404.
    const pending = await uploadToFakeS3(
      user.session,
      user.user.id,
      'pending.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, pending.materialId);
    const notReady = await user.session.post('/api/lessons/generate', {
      title: 'Too early',
      materialIds: [pending.materialId],
    });
    expect(notReady.status).toBe(404);
    expect((notReady.body as { code: string }).code).toBe('not_found');
  });

  it('validates the request body strictly', async () => {
    const user = await setup();
    const empty = await user.session.post('/api/lessons/generate', {
      title: 'No materials',
      materialIds: [],
    });
    expect(empty.status).toBe(400);

    const oversized = await user.session.post('/api/lessons/generate', {
      title: 'Too many',
      materialIds: Array.from({ length: 6 }, () => '507f191e810c19729de860ea'),
    });
    expect(oversized.status).toBe(400);

    const duplicated = await user.session.post('/api/lessons/generate', {
      title: 'Duplicates',
      materialIds: ['507f191e810c19729de860ea', '507f191e810c19729de860ea'],
    });
    expect(duplicated.status).toBe(400);

    const injected = await user.session.post('/api/lessons/generate', {
      title: 'Injected',
      materialIds: ['507f191e810c19729de860ea'],
      isAdmin: true,
    });
    expect(injected.status).toBe(400);
  });

  it('keeps request polling tenant-scoped and non-revealing', async () => {
    const owner = await setup();
    const upload = await uploadReadyMaterial(owner, 'poll-owner.md');

    const created = await owner.session.post('/api/lessons/generate', {
      title: 'Poll me',
      materialIds: [upload.materialId],
    });
    expect(created.status).toBe(202);
    const requestId = (created.body as { requestId: string }).requestId;

    const other = await setup();
    const foreign = await other.session.get(`/api/lesson-requests/${requestId}`);
    expect(foreign.status).toBe(404);
    expect((foreign.body as { code: string }).code).toBe('not_found');

    const unknown = await owner.session.get('/api/lesson-requests/507f1f77bcf86cd799439099');
    expect(unknown.status).toBe(404);

    await runGenerationRequest(requestId, owner.user.id);
    const count = await LessonGenerationRequest.countDocuments({ userId: owner.user.id }).exec();
    expect(count).toBe(1);
  });
});
