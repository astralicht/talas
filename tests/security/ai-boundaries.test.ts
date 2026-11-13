import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../helpers/app-server';
import { registerVerifiedUser } from '../helpers/client';
import { runPipeline, resetPipelineState, generateLessonForMaterial } from '../helpers/pipeline';
import { confirmMaterial, uploadToFakeS3 } from '../helpers/storage-fake';
import { TEXT_MATERIAL_BYTES } from '../fixtures/materials';
import { Lesson } from '@/lib/db/models/lesson';
import { setGenerateObjectForTests } from '@/lib/ai/generate-lesson';
import { resetEnvCache } from '@/lib/env';

/** Flips the AI seam env in-process; the worker fakes read env on every call. */
function setAiFakes(fake: boolean, faultInjection: boolean): void {
  process.env.AI_FAKE_LESSON = String(fake);
  process.env.AI_FAULT_INJECTION = String(faultInjection);
  resetEnvCache();
}

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
  setAiFakes(true, false);
});

afterAll(async () => {
  await stopTestApp();
  setGenerateObjectForTests(null);
  setAiFakes(true, false);
});

describe('AI provider boundaries', () => {
  it('stores a safe failure state when the provider is unavailable and recovers on retry', async () => {
    const user = await registerVerifiedUser(appUrl);
    setAiFakes(false, true);
    try {
      const upload = await uploadToFakeS3(
        user.session,
        user.user.id,
        'ai-fail.md',
        'text/markdown',
        TEXT_MATERIAL_BYTES,
      );
      await confirmMaterial(user.session, upload.materialId);
      // The automatic pipeline is explicit-only now (specs/005): scan and parse
      // complete without touching the AI, and the material ends ready.
      const seen = await runPipeline({ materialId: upload.materialId });
      expect(seen.map((job) => job.type)).toEqual(['scan_material', 'parse_material']);

      const parsed = await user.session.get(`/api/materials/${upload.materialId}`);
      expect((parsed.body as { status: string }).status).toBe('ready');

      // The generation stage is driven explicitly, like the request API would.
      await generateLessonForMaterial(upload.materialId, user.user.id);

      const material = await user.session.get(`/api/materials/${upload.materialId}`);
      const view = material.body as { status: string; failureCode: string | null };
      expect(view.status).toBe('failed');
      expect(view.failureCode).toBe('provider_unavailable');

      // Nothing persisted: no lesson, no revisions.
      expect(await Lesson.countDocuments({ userId: user.user.id })).toBe(0);

      // The retry endpoint resets a parsed material to ready; a new generation
      // is requested separately (specs/005).
      const retry = await user.session.post(`/api/materials/${upload.materialId}/retry`);
      expect(retry.status).toBe(202);

      const retried = await user.session.get(`/api/materials/${upload.materialId}`);
      expect((retried.body as { status: string }).status).toBe('ready');
    } finally {
      setAiFakes(true, false);
    }
  });

  it('saves a bounded fake lesson under the 1 MB persistence ceiling', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'large.md',
      'text/markdown',
      TEXT_MATERIAL_BYTES,
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });
    await generateLessonForMaterial(upload.materialId, user.user.id);

    const lesson = await Lesson.findOne({ userId: user.user.id })
      .lean<{ contentMarkdown: string }>()
      .exec();
    expect(lesson?.contentMarkdown).toContain('# Generated study lesson');
    expect(lesson?.contentMarkdown.length).toBeLessThan(1_048_576);
  });
});
