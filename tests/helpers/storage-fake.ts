import { storageKeyFor } from '@/lib/db/repositories/material-repository';
import type { TestSession } from './client';
import { fakeUpload } from './pipeline';

export interface PresignView {
  materialId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface MaterialView {
  id: string;
  originalFilename: string;
  detectedMime: string | null;
  sizeBytes: number;
  status: string;
  scanResult: string;
  pageCount: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
}

export interface ProcessingStatusView extends MaterialView {
  attempts: number;
  updatedAt: string;
}

/** Presigns, writes to the fake store with the presigned headers, returns the material id. */
export async function uploadToFakeS3(
  session: TestSession,
  ownerId: string,
  filename: string,
  contentType: string,
  bytes: Buffer,
): Promise<{ materialId: string; storageKey: string; presigned: PresignView }> {
  const presign = await session.post('/api/materials/presign', {
    filename,
    declaredMime: contentType,
    sizeBytes: bytes.byteLength,
  });
  if (presign.status !== 201) {
    throw new Error(`presign failed: ${presign.status} ${JSON.stringify(presign.body)}`);
  }
  const presigned = presign.body as PresignView;
  const storageKey = storageKeyFor(ownerId, presigned.materialId);
  fakeUpload(storageKey, bytes, presigned.headers['Content-Type'] ?? contentType);
  return { materialId: presigned.materialId, storageKey, presigned };
}

export async function confirmMaterial(session: TestSession, materialId: string) {
  return session.post('/api/materials', { materialId });
}

export async function materialStatus(session: TestSession, materialId: string) {
  return session.get(`/api/materials/${materialId}/status`);
}
