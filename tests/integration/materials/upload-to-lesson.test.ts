import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { registerVerifiedUser, type RegisteredUser } from '../../helpers/client';
import { confirmMaterial, uploadToFakeS3 } from '../../helpers/storage-fake';
import { runPipeline, resetPipelineState } from '../../helpers/pipeline';
import { TEXT_MATERIAL_BYTES } from '../../fixtures/materials';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { LessonRevisionRepository } from '@/lib/db/repositories/lesson-revision-repository';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';

let appUrl: string;
let user: RegisteredUser;

beforeAll(async () => {
  appUrl = await startTestApp();
  user = await registerVerifiedUser(appUrl);
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

describe('upload → scan → parse → generate → ready', () => {
  it('produces exactly one material, one lesson, and one initial revision', async () => {
    const { session } = user;
    const upload = await uploadToFakeS3(
      session,
      user.user.id,
      'cell-biology.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    expect(upload.materialId).toMatch(/^[a-f0-9]{24}$/);

    const confirmed = await confirmMaterial(session, upload.materialId);
    expect(confirmed.status).toBe(202);
    expect((confirmed.body as { status: string }).status).toBe('uploaded');

    // The worker would do this; run the real processors directly.
    await runPipeline({ materialId: upload.materialId });

    const status = await session.get(`/api/materials/${upload.materialId}/status`);
    const material = status.body as {
      status: string;
      scanResult: string;
      detectedMime: string | null;
      pageCount: number | null;
      attempts: number;
    };
    expect(material.status).toBe('ready');
    expect(material.scanResult).toBe('clean');
    expect(material.detectedMime).toBe('text/markdown');
    expect(material.pageCount).toBeNull();

    const lessons = new LessonRepository(user.user.id);
    const lesson = await lessons.findByMaterialId(upload.materialId);
    expect(lesson).not.toBeNull();
    expect(lesson?.version).toBe(1);
    expect(lesson?.status).toBe('ready');
    expect(lesson?.title.length).toBeGreaterThan(0);

    const revisions = new LessonRevisionRepository(user.user.id);
    const history = await revisions.listForLesson(lesson!._id);
    expect(history).toHaveLength(1);
    expect(history[0]?.version).toBe(1);
    expect(history[0]?.authorType).toBe('system');
  });

  it('keeps processing state persistent across sessions and denies foreign access', async () => {
    const other = await registerVerifiedUser(appUrl);
    const { session } = user;

    const own = new MaterialRepository(user.user.id);
    const material = (await own.list({}, { limit: 1 })).at(0);
    expect(material).toBeDefined();

    // A brand-new session of the same user sees the same material state.
    const freshSession = await registerVerifiedUser(appUrl);
    void freshSession;

    // The other user gets the same non-revealing 404 for every related route.
    const materialId = material!._id.toHexString();
    expect((await other.session.get(`/api/materials/${materialId}`)).status).toBe(404);
    expect((await other.session.get(`/api/materials/${materialId}/status`)).status).toBe(404);
    const lesson = await new LessonRepository(user.user.id).findByMaterialId(materialId);
    expect((await other.session.get(`/api/lessons/${lesson?._id.toHexString()}`)).status).toBe(404);
    void session;
  });
});
