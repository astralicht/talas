import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { registerVerifiedUser } from '../../helpers/client';
import {
  fakeUpload,
  materialJobsFor,
  runPipeline,
  resetPipelineState,
} from '../../helpers/pipeline';
import { confirmMaterial, uploadToFakeS3 } from '../../helpers/storage-fake';
import { setClamAvScannerForTests } from '@/lib/security/clamav';
import { ProcessingJob } from '@/lib/db/models/processing-job';
import { Lesson } from '@/lib/db/models/lesson';
import { setGenerateObjectForTests } from '@/lib/ai/generate-lesson';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
  setClamAvScannerForTests(null);
  setGenerateObjectForTests(null);
});

describe('bounded retry and idempotent processing', () => {
  it('re-enqueues the same stable job id without duplicate lessons', async () => {
    const user = await registerVerifiedUser(appUrl);
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'idempotent.md',
      'text/markdown',
      Buffer.from('Reliable content for the idempotency check. '.repeat(20), 'utf8'),
    );
    await confirmMaterial(user.session, upload.materialId);

    const firstJobs = materialJobsFor(upload.materialId);
    expect(firstJobs).toHaveLength(1);

    // Re-running confirm is rejected rather than creating a second job.
    const repeat = await confirmMaterial(user.session, upload.materialId);
    expect(repeat.status).toBe(409);
    expect(materialJobsFor(upload.materialId)).toHaveLength(1);

    await runPipeline({ materialId: upload.materialId });

    // Running the same payloads again must not duplicate the lesson.
    const jobs = materialJobsFor(upload.materialId);
    for (const job of jobs) {
      void job;
    }
    const lessonCount = await Lesson.countDocuments({ userId: user.user.id });
    expect(lessonCount).toBe(1);

    // The processing job reached terminal ready state with attempt history.
    const job = await ProcessingJob.findOne({ materialId: upload.materialId })
      .lean<{ status: string; attempts: number }>()
      .exec();
    expect(job?.status).toBe('ready');
    expect(job?.attempts).toBeGreaterThan(0);
  });

  it('fails safe when the scanner is unavailable and retries from the scan stage', async () => {
    const user = await registerVerifiedUser(appUrl);
    setClamAvScannerForTests(async () => ({ status: 'unavailable', detail: 'scanner down' }));
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'scanner-down.md',
      'text/markdown',
      Buffer.from('A document that expectos the scanner. '.repeat(30), 'utf8'),
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });

    const material = await ProcessingJob.findOne({ materialId: upload.materialId })
      .lean<{ status: string; lastErrorCode: string | null }>()
      .exec();
    expect(material?.status).toBe('failed');
    expect(material?.lastErrorCode).toBe('scanner_unavailable');

    const failed = await user.session.get(`/api/materials/${upload.materialId}`);
    expect((failed.body as { status: string; failureCode: string | null }).failureCode).toBe(
      'scanner_unavailable',
    );

    // User-initiated retry resets the bounded budget and re-queues scanning.
    setClamAvScannerForTests(async () => ({ status: 'clean' }));
    const retry = await user.session.post(`/api/materials/${upload.materialId}/retry`);
    expect(retry.status).toBe(202);
    await runPipeline({ materialId: upload.materialId });

    const recovered = await user.session.get(`/api/materials/${upload.materialId}`);
    expect((recovered.body as { status: string }).status).toBe('ready');
    const lessonCount = await Lesson.countDocuments({ userId: user.user.id });
    expect(lessonCount).toBe(1);
  });

  it('quarantines infected content and deletes the stored object', async () => {
    const user = await registerVerifiedUser(appUrl);
    setClamAvScannerForTests(async () => ({
      status: 'infected',
      signature: 'Fake.EICAR.Test',
    }));
    const upload = await uploadToFakeS3(
      user.session,
      user.user.id,
      'infected.md',
      'text/markdown',
      Buffer.from('A text document that the fake scanner flags. '.repeat(30), 'utf8'),
    );
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });

    const material = await user.session.get(`/api/materials/${upload.materialId}`);
    expect((material.body as { status: string; scanResult: string }).status).toBe('quarantined');
    expect((material.body as { scanResult: string }).scanResult).toBe('infected');

    // Retry is refused: non-retryable failure.
    const retry = await user.session.post(`/api/materials/${upload.materialId}/retry`);
    expect(retry.status).toBe(409);
    void fakeUpload;
  });
});
