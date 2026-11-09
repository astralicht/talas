import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { registerVerifiedUser } from '../../helpers/client';
import { runPipeline, resetPipelineState } from '../../helpers/pipeline';
import { confirmMaterial, uploadToFakeS3 } from '../../helpers/storage-fake';
import { TEXT_MATERIAL_BYTES } from '../../fixtures/materials';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { LessonRevisionRepository } from '@/lib/db/repositories/lesson-revision-repository';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

interface LessonFixture {
  lessonId: string;
  version: number;
  title: string;
  content: string;
}

async function seedLesson(userEmailSuffixLeft?: string): Promise<LessonFixture & { user: Awaited<ReturnType<typeof registerVerifiedUser>> }> {
  void userEmailSuffixLeft;
  const user = await registerVerifiedUser(appUrl);
  const upload = await uploadToFakeS3(user.session, user.user.id, 'conflict.md', 'text/markdown', TEXT_MATERIAL_BYTES);
  await confirmMaterial(user.session, upload.materialId);
  await runPipeline();
  const lessons = new LessonRepository(user.user.id);
  const lesson = await lessons.findByMaterialId(upload.materialId);
  return {
    user,
    lessonId: lesson!._id.toHexString(),
    version: lesson!.version,
    title: lesson!.title,
    content: lesson!.contentMarkdown,
  };
}

describe('lesson autosave with optimistic concurrency', () => {
  it('persists an autosave across a reload and appends a revision', async () => {
    const seeded = await seedLesson();
    const { session } = seeded.user;
    const edited = `${seeded.content}\n\n## Autosaved chapter\n\nWritten by the session.`;

    const saved = await session.patch(`/api/lessons/${seeded.lessonId}`, {
      version: seeded.version,
      title: seeded.title,
      contentMarkdown: edited,
    });
    expect(saved.status).toBe(200);
    const savedBody = saved.body as { lesson: { version: number; contentMarkdown: string }; revision: { version: number } };
    expect(savedBody.lesson.version).toBe(seeded.version + 1);
    expect(savedBody.lesson.contentMarkdown).toContain('Autosaved chapter');
    expect(savedBody.revision.version).toBe(seeded.version + 1);

    // A fresh session (like a reload) reads the same persisted content.
    const reread = await session.get(`/api/lessons/${seeded.lessonId}`);
    expect((reread.body as { contentMarkdown: string }).contentMarkdown).toBe(savedBody.lesson.contentMarkdown);

    const revisions = new LessonRevisionRepository(seeded.user.user.id);
    const history = await revisions.listForLesson(seeded.lessonId);
    expect(history.map((revision) => revision.version)).toEqual([
      savedBody.revision.version,
      seeded.version,
    ]);
    expect(history.at(-1)?.authorType).toBe('system');
  });

  it('reports a conflict instead of overwriting on a second tab save', async () => {
    const seeded = await seedLesson();
    const { session } = seeded.user;

    const first = await session.patch(`/api/lessons/${seeded.lessonId}`, {
      version: seeded.version,
      title: seeded.title,
      contentMarkdown: `${seeded.content}\n\nFirst tab edits win.`,
    });
    expect(first.status).toBe(200);

    // The second tab still holds the original version; its save must 409 with no write.
    const second = await session.patch(`/api/lessons/${seeded.lessonId}`, {
      version: seeded.version,
      title: seeded.title,
      contentMarkdown: `${seeded.content}\n\nSecond tab edits would clash.`,
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'conflict' });

    // The stored content is the first tab's version, untouched by the stale save.
    const reread = await session.get(`/api/lessons/${seeded.lessonId}`);
    expect((reread.body as { contentMarkdown: string }).contentMarkdown).toContain('First tab edits win.');
    expect((reread.body as { contentMarkdown: string }).contentMarkdown).not.toContain('Second tab edits');

    const revisions = new LessonRevisionRepository(seeded.user.user.id);
    const history = await revisions.listForLesson(seeded.lessonId);
    expect(history).toHaveLength(2); // generation + first tab; no phantom revision from the conflict
  });

  it('rejects oversized content with a validation error', async () => {
    const seeded = await seedLesson();
    const huge = 'x'.repeat(1_048_577);
    const response = await seeded.user.session.patch(`/api/lessons/${seeded.lessonId}`, {
      version: seeded.version,
      title: seeded.title,
      contentMarkdown: huge,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
  });
});
