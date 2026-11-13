import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { registerVerifiedUser, type RegisteredUser } from '../../helpers/client';
import { confirmMaterial, uploadToFakeS3 } from '../../helpers/storage-fake';
import { runPipeline, resetPipelineState, runGenerationRequest } from '../../helpers/pipeline';
import { buildDocxWithImage } from '../../fixtures/docx';
import { buildPdf } from '../../fixtures/pdf';
import { MaterialAsset } from '@/lib/db/models/material-asset';
import { getFakeObjectStore } from '@/lib/storage/s3';

let appUrl: string;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

function fixturePng(): Buffer {
  const canvas = createCanvas(96, 72);
  const context = canvas.getContext('2d');
  context.fillStyle = '#2a6fbb';
  context.fillRect(0, 0, 96, 72);
  return canvas.toBuffer('image/png');
}

describe('material image assets (specs/005 FR-008)', () => {
  it('stores DOCX images as tenant-scoped assets during the pipeline', async () => {
    const user = await registerVerifiedUser(appUrl);
    const docx = await buildDocxWithImage(fixturePng());
    const upload = await uploadToFakeS3(user.session, user.user.id, 'figures.docx', DOCX_MIME, docx);
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });

    const assets = await MaterialAsset.find({ userId: user.user.id, materialId: upload.materialId })
      .lean<{ _id: { toHexString(): string }; contentType: string; byteSize: number; assetKey: string }[]>()
      .exec();
    expect(assets).toHaveLength(1);
    expect(assets[0]?.contentType).toBe('image/png');
    expect(assets[0]?.byteSize).toBeGreaterThan(0);
    expect(assets[0]?.assetKey).toContain(`/images/${assets[0]?._id.toHexString()}`);
    expect(getFakeObjectStore().objects.get(assets[0]?.assetKey ?? '')).toBeDefined();

    // The generated lesson may reference the asset through the fake AI path;
    // the catalog URL must point at the tenant-scoped route.
    await user.session.post('/api/lessons/generate', {
      title: 'With figure',
      materialIds: [upload.materialId],
    });
    const queued = (await import('@/lib/jobs/queues')).takeMemoryJobsForTests('lesson-generation');
    expect(queued).toHaveLength(1);
    const requestId = (queued[0]?.payload as { requestId: string }).requestId;
    const { processGenerateLessonRequest } = await import('@/worker/processors/generate-lesson');
    await processGenerateLessonRequest(queued[0]?.payload as never);

    const { Lesson } = await import('@/lib/db/models/lesson');
    const lesson = await Lesson.findOne({ userId: user.user.id })
      .lean<{ contentMarkdown: string }>()
      .exec();
    expect(lesson?.contentMarkdown).toContain(`![Figure](/api/materials/${upload.materialId}/images/${assets[0]?._id.toHexString()})`);
  });

  it('renders image-only PDFs into page assets instead of failing', async () => {
    const user = await registerVerifiedUser(appUrl);
    const pdf = buildPdf([]);
    const upload = await uploadToFakeS3(user.session, user.user.id, 'scan.pdf', 'application/pdf', pdf);
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });

    const assets = await MaterialAsset.find({ userId: user.user.id, materialId: upload.materialId })
      .lean<{ contentType: string; pageNumber: number | null; width: number | null }[]>()
      .exec();
    expect(assets.length).toBeGreaterThan(0);
    expect(assets[0]?.contentType).toBe('image/png');
    expect(assets[0]?.pageNumber).toBe(1);
    expect(assets[0]?.width).toBeGreaterThan(0);

    // Generation against an image-only source rides the vision path.
    const created = await user.session.post('/api/lessons/generate', {
      title: 'Image-only lesson',
      materialIds: [upload.materialId],
    });
    expect(created.status).toBe(202);
    const requestId = (created.body as { requestId: string }).requestId;
    await runGenerationRequest(requestId, user.user.id);

    const poll = await user.session.get(`/api/lesson-requests/${requestId}`);
    expect((poll.body as { status: string }).status).toBe('ready');
  });

  it('serves assets tenant-scoped with private caching and safe 404s', async () => {
    const user = await registerVerifiedUser(appUrl);
    const docx = await buildDocxWithImage(fixturePng());
    const upload = await uploadToFakeS3(user.session, user.user.id, 'routed.docx', DOCX_MIME, docx);
    await confirmMaterial(user.session, upload.materialId);
    await runPipeline({ materialId: upload.materialId });
    const asset = await MaterialAsset.findOne({ userId: user.user.id, materialId: upload.materialId })
      .lean<{ _id: { toHexString(): string } }>()
      .exec();
    expect(asset).toBeTruthy();
    const assetId = asset!._id.toHexString();

    const ok = await user.session.get(`/api/materials/${upload.materialId}/images/${assetId}`);
    expect(ok.status).toBe(200);
    expect(String(ok.headers['content-type'] ?? '')).toContain('image/png');
    expect(String(ok.headers['cache-control'] ?? '')).toContain('private');

    // Foreign ids answer the same non-revealing 404.
    const other = await registerVerifiedUser(appUrl);
    const foreign = await other.session.get(`/api/materials/${upload.materialId}/images/${assetId}`);
    expect(foreign.status).toBe(404);
    expect((foreign.body as { code: string }).code).toBe('not_found');

    const unknown = await user.session.get(`/api/materials/${upload.materialId}/images/${'f'.repeat(24)}`);
    expect(unknown.status).toBe(404);

    const malformed = await user.session.get(`/api/materials/${upload.materialId}/images/not-an-id`);
    expect(malformed.status).toBe(400);

    // Deleting the material removes its assets and stored bytes.
    const deleted = await user.session.delete(`/api/materials/${upload.materialId}`);
    expect(deleted.status).toBe(204);
    const remaining = await MaterialAsset.countDocuments({ userId: user.user.id, materialId: upload.materialId }).exec();
    expect(remaining).toBe(0);
    expect(getFakeObjectStore().objects.get(`materials/${user.user.id}/${upload.materialId}/images/${assetId}`)).toBeUndefined();
  });
});
